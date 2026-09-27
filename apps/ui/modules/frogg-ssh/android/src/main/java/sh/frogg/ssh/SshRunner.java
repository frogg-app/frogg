package sh.frogg.ssh;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/**
 * Runs one command on an SSH host with a script on its stdin: what the deploy
 * engine's `ExecuteScript` asks for, done with JSch because a phone has no
 * `ssh` binary, agent or key files. Plain JVM code, so it can be exercised
 * against a real sshd off-device.
 *
 * Host keys are trusted on first use: the first key a host presents is
 * recorded in the {@link HostKeyStore}, and a later connection that presents a
 * different key of the same type is refused rather than silently re-trusted.
 */
public final class SshRunner {
  public interface HostKeyStore {
    String get(String key);

    void put(String key, String fingerprint);
  }

  public interface OutputListener {
    void onLine(String stream, String text);
  }

  public static final class Request {
    public String host;
    public int port = 22;
    public String user;
    public String password;
    public String privateKey;
    public String passphrase;
    public String command;
    public String stdin = "";
    public long timeoutMs = 45_000;
    public int connectTimeoutMs = 10_000;
  }

  public static final class Result {
    public final String stdout;
    public final String stderr;
    /** Null when the remote end closed without an exit status. */
    public final Integer code;

    Result(String stdout, String stderr, Integer code) {
      this.stdout = stdout;
      this.stderr = stderr;
      this.code = code;
    }
  }

  private static final int KEEP_CHARS = 65_536;
  private static final int MAX_LINE = 16_384;

  private volatile Session session;
  private volatile boolean cancelled;

  /** Stops the run from any thread; `run` then throws "Cancelled". */
  public void cancel() {
    cancelled = true;
    Session current = session;
    if (current != null) current.disconnect();
  }

  public Result run(Request request, HostKeyStore store, OutputListener listener) throws Exception {
    if (request.user == null || request.user.isEmpty()) {
      throw new IllegalArgumentException("An SSH user is required (user@host).");
    }
    TofuRepository hostKeys = new TofuRepository(store, request.host, request.port);
    JSch jsch = new JSch();
    jsch.setHostKeyRepository(hostKeys);
    boolean hasKey = request.privateKey != null && !request.privateKey.trim().isEmpty();
    boolean hasPassword = nonEmpty(request.password);
    if (hasKey) {
      try {
        jsch.addIdentity(
            "deploy-key",
            request.privateKey.trim().concat("\n").getBytes(StandardCharsets.UTF_8),
            null,
            nonEmpty(request.passphrase)
                ? request.passphrase.getBytes(StandardCharsets.UTF_8)
                : null);
      } catch (JSchException error) {
        throw new Exception(
            "The private key could not be read: wrong passphrase or unsupported format ("
                + error.getMessage()
                + ").");
      }
    }

    Session current = jsch.getSession(request.user, request.host, request.port);
    session = current;
    StringBuilder methods = new StringBuilder();
    if (hasKey) methods.append("publickey");
    if (hasPassword) {
      if (methods.length() > 0) methods.append(',');
      methods.append("keyboard-interactive,password");
    }
    current.setConfig("StrictHostKeyChecking", "yes");
    current.setConfig(
        "PreferredAuthentications", methods.length() > 0 ? methods.toString() : "publickey");
    if (hasPassword) current.setUserInfo(new PasswordInfo(request.password));
    current.setServerAliveInterval(15_000);
    ChannelExec channel = null;
    try {
      if (cancelled) throw new Exception("Cancelled");
      try {
        current.connect(request.connectTimeoutMs);
      } catch (JSchException error) {
        throw connectError(error, hostKeys, methods.toString(), request);
      }
      channel = (ChannelExec) current.openChannel("exec");
      channel.setCommand(request.command);
      Collector stdout = new Collector("stdout", channel.getInputStream(), listener);
      Collector stderr = new Collector("stderr", channel.getErrStream(), listener);
      OutputStream stdin = channel.getOutputStream();
      channel.connect(request.connectTimeoutMs);
      stdout.start();
      stderr.start();
      try {
        stdin.write(request.stdin.getBytes(StandardCharsets.UTF_8));
        stdin.flush();
        stdin.close();
      } catch (IOException ignored) {
        // Early remote exit breaks the pipe; the exit status says why.
      }
      long deadline = System.currentTimeMillis() + request.timeoutMs;
      while (!channel.isClosed()) {
        if (cancelled) throw new Exception("Cancelled");
        if (System.currentTimeMillis() > deadline) {
          throw new Exception(
              "SSH command timed out after " + (request.timeoutMs / 1000) + " s.");
        }
        if (!current.isConnected()) break;
        Thread.sleep(50);
      }
      stdout.join(3_000);
      stderr.join(3_000);
      if (cancelled) throw new Exception("Cancelled");
      int status = channel.getExitStatus();
      return new Result(stdout.text(), stderr.text(), status < 0 ? null : status);
    } catch (Exception error) {
      if (cancelled) throw new Exception("Cancelled");
      throw error;
    } finally {
      if (channel != null) channel.disconnect();
      current.disconnect();
      session = null;
    }
  }

  private static boolean nonEmpty(String value) {
    return value != null && !value.isEmpty();
  }

  /** Spells failures the way OpenSSH does where the deploy flow looks for it. */
  private static Exception connectError(
      JSchException error, TofuRepository hostKeys, String methods, Request request) {
    if (hostKeys.changed != null) {
      return new Exception(
          "The host key for "
              + request.host
              + ":"
              + request.port
              + " has changed ("
              + hostKeys.changed
              + "). Refusing to connect: this may be a different machine.");
    }
    String message = error.getMessage() == null ? "" : error.getMessage();
    if (message.startsWith("Auth fail") || message.startsWith("Auth cancel")) {
      return new Exception(
          request.user
              + "@"
              + request.host
              + ": Permission denied ("
              + (methods.isEmpty() ? "publickey" : methods)
              + ").");
    }
    if (error.getCause() != null && error.getCause().getMessage() != null) {
      return new Exception(
          "ssh: connect to host "
              + request.host
              + " port "
              + request.port
              + ": "
              + error.getCause().getMessage());
    }
    return new Exception("ssh: " + request.host + ": " + message);
  }

  /** `SHA256:<base64, unpadded>`, as OpenSSH prints host key fingerprints. */
  static String fingerprint(byte[] key) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(key);
      return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest);
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }

  /** Trust on first use, keyed by host, port and key type. */
  static final class TofuRepository implements HostKeyRepository {
    private final HostKeyStore store;
    private final String host;
    private final int port;
    volatile String changed;

    TofuRepository(HostKeyStore store, String host, int port) {
      this.store = store;
      this.host = host;
      this.port = port;
    }

    private String keyFor(String type) {
      return host + ":" + port + ":" + type;
    }

    @Override
    public int check(String ignoredHost, byte[] key) {
      String type;
      try {
        type = new HostKey(host, key).getType();
      } catch (JSchException error) {
        return NOT_INCLUDED;
      }
      String actual = fingerprint(key);
      String known = store.get(keyFor(type));
      if (known == null) {
        store.put(keyFor(type), actual);
        return OK;
      }
      if (known.equals(actual)) return OK;
      changed = type + " " + known + " → " + actual;
      return CHANGED;
    }

    @Override
    public void add(HostKey hostkey, UserInfo ui) {}

    @Override
    public void remove(String host, String type) {}

    @Override
    public void remove(String host, String type, byte[] key) {}

    @Override
    public String getKnownHostsRepositoryID() {
      return "frogg-tofu";
    }

    @Override
    public HostKey[] getHostKey() {
      return new HostKey[0];
    }

    @Override
    public HostKey[] getHostKey(String host, String type) {
      return new HostKey[0];
    }
  }

  /** Answers password and keyboard-interactive prompts with the one password given. */
  private static final class PasswordInfo implements UserInfo, UIKeyboardInteractive {
    private final String password;

    PasswordInfo(String password) {
      this.password = password;
    }

    @Override
    public String getPassphrase() {
      return null;
    }

    @Override
    public String getPassword() {
      return password;
    }

    @Override
    public boolean promptPassword(String message) {
      return true;
    }

    @Override
    public boolean promptPassphrase(String message) {
      return false;
    }

    @Override
    public boolean promptYesNo(String message) {
      return false;
    }

    @Override
    public void showMessage(String message) {}

    @Override
    public String[] promptKeyboardInteractive(
        String destination, String name, String instruction, String[] prompt, boolean[] echo) {
      String[] answers = new String[prompt.length];
      for (int index = 0; index < prompt.length; index++) {
        answers[index] = echo[index] ? "" : password;
      }
      return answers;
    }
  }

  /** Reads one stream, reporting whole lines and keeping the tail of the text. */
  private static final class Collector extends Thread {
    private final String stream;
    private final InputStream input;
    private final OutputListener listener;
    private final StringBuilder kept = new StringBuilder();

    Collector(String stream, InputStream input, OutputListener listener) {
      this.stream = stream;
      this.input = input;
      this.listener = listener;
      setDaemon(true);
      setName("frogg-ssh-" + stream);
    }

    synchronized String text() {
      return kept.toString();
    }

    private synchronized void keep(char[] buffer, int count) {
      kept.append(buffer, 0, count);
      if (kept.length() > KEEP_CHARS) kept.delete(0, kept.length() - KEEP_CHARS);
    }

    private void emit(StringBuilder pending, int end, int skip) {
      String line = pending.substring(0, end);
      if (line.endsWith("\r")) line = line.substring(0, line.length() - 1);
      pending.delete(0, end + skip);
      if (listener != null) listener.onLine(stream, line);
    }

    @Override
    public void run() {
      StringBuilder pending = new StringBuilder();
      char[] buffer = new char[8192];
      try (Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
        int count;
        while ((count = reader.read(buffer)) != -1) {
          keep(buffer, count);
          pending.append(buffer, 0, count);
          while (true) {
            int newline = pending.indexOf("\n");
            if (newline >= 0 && newline < MAX_LINE) emit(pending, newline, 1);
            else if (pending.length() > MAX_LINE) emit(pending, MAX_LINE, 0);
            else break;
          }
        }
      } catch (IOException ignored) {
        // The session closed under the reader; what arrived is kept.
      }
      if (pending.length() > 0) emit(pending, pending.length(), 0);
    }
  }
}
