import assert from "node:assert/strict";
import { escapeHtml, renderMarkdown } from "../src/pet-chat-markdown.js";

assert.equal(escapeHtml(`<tag attr="x">'&`), "&lt;tag attr=&quot;x&quot;&gt;&#39;&amp;");

assert.equal(
  renderMarkdown("**bold** *italic* `code`\n- one\n- two\n\nafter"),
  '<strong>bold</strong> <em>italic</em> <code class="chat-code-inline">code</code><ul><br><li>one</li>\n<li>two</li>\n</ul>after',
);

assert.equal(
  renderMarkdown("```ts\nconst value = '<safe>';\n```"),
  '<pre class="chat-code-block"><code>const value = &#39;&lt;safe&gt;&#39;;</code></pre>',
);

assert.equal(
  renderMarkdown("- first\nplain\n* second"),
  "<ul><br><li>first</li>\n</ul>plain<ul><br><li>second</li>\n</ul>",
);

console.log("pet-chat-markdown tests passed.");
