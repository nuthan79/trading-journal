import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { MIN_MESSAGE, whyNotSendable, looksLikeEmail } from "@/lib/contact";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE MESSAGE THAT COULD NOT BE SENT.
 *
 * A user typed "i need US" — nine characters — into the support form and met
 * a grey button that did nothing and explained nothing. The minimum was ten,
 * stated nowhere on the page, and a disabled button cannot be clicked or
 * focused, so there was no way to reach the reason. He reported the form as
 * broken, which from where he sat it was.
 */
test("the message that was refused now sends", () => {
  eq(whyNotSendable({ email: "abhit@gmail.com", message: "i need US " }), "",
     "nine characters and a real address is a message somebody meant to send");
});

test("what cannot be sent is refused in words, never in silence", () => {
  for (const [input, what] of [
    [{ email: "", message: "a real message" }, "no email"],
    [{ email: "not-an-address", message: "a real message" }, "a bad email"],
    [{ email: "a@b.co", message: "" }, "no message"],
    [{ email: "a@b.co", message: "  " }, "only spaces"],
  ]) {
    const why = whyNotSendable(input);
    ok(why, `${what} is refused without saying why`);
    ok(/[a-z]/.test(why) && why.length > 12, `${what} gets a reason, not a code`);
  }
});

/**
 * A DEAD CONTROL IS THE BUG ITSELF. The button may grey out while a send is in
 * flight — that is feedback — but never for a validity rule, because that is
 * the state with no way out of it.
 */
test("the send button is disabled only while sending", () => {
  const src = read("components/ContactForm.jsx");
  const btn = src.slice(src.indexOf('type="submit"'), src.indexOf("</button>"));
  ok(/disabled=\{busy\}/.test(btn), "the button disables for something other than being busy");
  ok(!/disabled=\{![a-z]/i.test(btn), "the button still disables on a validity flag");
  ok(/whyNotSendable\(/.test(src), "the form does not ask for the reason it cannot send");
});

/**
 * ONE COPY OF THE RULE. The form decides whether a send is attempted and the
 * route decides whether it is accepted; two numbers drifting apart means
 * either silent refusals or pointless round trips, and nothing would report
 * a fault either way.
 */
test("the form and the route share one minimum and one email test", () => {
  const route = read("app/api/contact/route.js");
  const form = read("components/ContactForm.jsx");
  ok(/from "@\/lib\/contact"/.test(route), "the route restates the rule instead of importing it");
  ok(/from "@\/lib\/contact"/.test(form), "the form restates the rule instead of importing it");
  for (const [f, src] of [["route", route], ["form", form]]) {
    ok(!/MIN_MESSAGE\s*=\s*\d/.test(src), `${f} declares its own minimum`);
    ok(!/const looksLikeEmail\s*=/.test(src), `${f} declares its own email test`);
  }
  ok(MIN_MESSAGE <= 4, `the floor is ${MIN_MESSAGE} — high enough to refuse a real short message`);
  ok(looksLikeEmail("a@b.co") && !looksLikeEmail("a@b"), "the shared email test still works");
});
