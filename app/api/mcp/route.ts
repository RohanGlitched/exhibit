import { CORS, mcpHandler } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A person who opens the endpoint in a browser gets a page that says what it is; MCP clients get the protocol. */
async function get(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const url = `${new URL(req.url).origin}/api/mcp`;
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Exhibit MCP server</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:42em;margin:10vh auto;padding:0 20px;color:#13203a;background:#dce4ef}main{background:#fbfcfd;padding:28px 30px;border-radius:3px;box-shadow:0 18px 40px -26px rgba(19,32,58,.45)}code{background:#e6edfd;padding:2px 6px;border-radius:3px;word-break:break-all}a{color:#1d4bc4}b{font-weight:650}.k{color:#d3242c;font-weight:700;letter-spacing:.06em;font-size:13px}</style>
<main><p class="k">EXHIBIT · MCP</p>
<h1 style="margin:.2em 0 .4em;font-size:30px">Run the dispute desk from your own agent</h1>
<p>This is Exhibit's Model Context Protocol server, over Streamable HTTP. There is nothing to see in a browser: add this address to an assistant that supports remote MCP servers (Claude, ChatGPT, VS Code and others):</p>
<p><code>${url}</code></p>
<p>Tools: <b>list_cases</b>, <b>get_case</b>, <b>argue_case</b>, <b>file_response</b> (evidence, accept or ruling; asks for confirmation), <b>cross_examine</b> (a simulated PayPal reviewer objects, Exhibit answers, the checker rules) and <b>open_case</b>. Every action is gated by PayPal's own links and checked by the same code as the website, on the PayPal sandbox with test money.</p>
<p>Then ask: "Which cases are waiting on me, and which should I refund?"</p>
<p><a href="/desk">The desk</a> · <a href="/">Exhibit home</a></p></main>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return mcpHandler(req);
}

const preflight = () => new Response(null, { status: 204, headers: CORS });

export { get as GET, mcpHandler as POST, mcpHandler as DELETE, preflight as OPTIONS };
