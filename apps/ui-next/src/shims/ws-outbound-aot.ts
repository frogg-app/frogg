// Stands in for @frogg/protocol's zod-aot validator (metro.config.js redirects it here). That
// generated module is a single multi-megabyte function, and Hermes runs out of memory compiling
// it; the source schema it is compiled from validates the same messages.
export { WSOutboundMessageSchema } from "@frogg/protocol/messages";
