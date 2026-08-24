# Privacy and data handling

abap-mcp analyzes only the source text and options supplied in an MCP tool call. It does not
connect to an SAP system, read arbitrary files, call external APIs, use analytics, or retain a
history of tool calls. Its ABAP parser and dated released-API snapshot are bundled with the
package.

## Local stdio use

With the default `abap-mcp` stdio transport, the MCP client starts the server as a local process.
The server processes tool inputs in memory and does not transmit or persist them. The ChatGPT,
Codex, or other host that sends the tool call has its own data-handling terms; using a local MCP
server does not prevent that host from processing source text already present in the conversation.

## Hosted Streamable HTTP use

With `abap-mcp-http`, tool inputs travel over the network to the machine running the service and
are processed in memory there. The server does not intentionally log request bodies, source text,
tool arguments, or tool results. Its own logs are limited to startup and fatal process errors.
Infrastructure in front of the process—proxies, hosting providers, observability agents, and
network controls—may have separate logging and retention policies set by the operator.

Operators should:

- expose the endpoint only over HTTPS;
- require the supported bearer-token control, or put equivalent authentication in front of it;
- keep request-body logging disabled at every proxy and platform layer;
- choose a region and retention policy appropriate for the ABAP source being processed; and
- publish their own operator identity, contact, subprocessors, retention period, and deletion
  process before inviting other people to use the service.

The included HTTP server has bounded requests and abuse controls, but these are not a substitute
for production identity, network, and monitoring controls.

## Data supplied with the package

The released-API lookup uses a compact, package-bundled transform of SAP's Apache-2.0 ABAP
Cloudification Repository. The snapshot date and upstream source are included in every relevant
result. No lookup query is sent to SAP.

## Questions

For this open-source implementation, use the repository's GitHub issue tracker. A hosted operator
must replace this section with its own privacy contact before public launch.
