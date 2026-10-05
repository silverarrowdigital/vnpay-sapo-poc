/**
 * The one input style, shared by every control on the checkout form.
 *
 * It lives in its own module because the form is split across components (`CheckoutForm` and
 * `AddressSelects`) and a copied class string is a copied style that drifts: the selects and the
 * text inputs sit on the same row and have to match exactly.
 */
export const FIELD_CLASS =
  "w-full rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink outline-none focus-visible:border-ink";

/** Shown under a field when the server rejected it. */
export const FIELD_ERROR_CLASS = "mt-1 block text-xs text-[color:var(--err)]";
