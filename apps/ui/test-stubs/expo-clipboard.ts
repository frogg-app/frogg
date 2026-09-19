// `expo-clipboard` ships an untranspiled-JSX paste button alongside the clipboard API, which
// fails to parse on import and takes out any test that mounts something able to copy.
export async function setStringAsync(_text: string): Promise<boolean> {
  return true;
}

export async function getStringAsync(): Promise<string> {
  return "";
}
