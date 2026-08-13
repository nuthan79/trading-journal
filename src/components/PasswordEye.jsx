"use client";

/**
 * The reveal control for password fields, in one place.
 *
 * It started as a local helper on the sign-in card and is now wanted by the
 * change-password sheet and the reset form as well. Three copies of an SVG
 * path is three chances for one of them to be redrawn and the others not, and
 * an eye that looks slightly different on the reset screen than on sign-in
 * reads as a different control doing a different thing.
 *
 * The icon is drawn rather than typed as an emoji so it inherits the button's
 * colour and keeps its shape everywhere — the emoji eye renders as a full
 * colour cartoon on Apple devices and would be the loudest thing on a form
 * whose whole job is to be quiet.
 *
 * Styles live in globals.css as .pw-wrap / .pw-eye rather than travelling with
 * this file, because styled-jsx scopes to the component that declares it and
 * these classes are applied by the callers' markup, not by anything here.
 */

export function Eye({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3.1" />
      {off && <path d="M4 20 20 4" />}
    </svg>
  );
}

/**
 * One switch for every password box on a form, rather than one per field.
 *
 * On a form with a new password and a repeat, the typo is as likely to be in
 * the second box as the first — so revealing one and then having to find a
 * second control is exactly the wrong moment to add a step. Nothing is shown
 * that the person at the keyboard did not just type.
 *
 * `type` is what callers spread onto their <input>; the button is rendered
 * beside it inside a .pw-wrap.
 */
export function RevealToggle({ on, onToggle }) {
  const what = on ? "Hide password" : "Show password";
  return (
    <button type="button" className="pw-eye" onClick={onToggle}
            aria-label={what} aria-pressed={on} title={what}>
      <Eye off={on} />
    </button>
  );
}

/** The input type the whole form should use. Keeps callers from writing the
 *  ternary out three times and getting one of them backwards. */
export const pwType = (revealed) => (revealed ? "text" : "password");
