/**
 * "Same as mobile number" for the WhatsApp field.
 *
 * While the box is ticked the WhatsApp number IS the mobile number (it is derived, not copied once), so it follows every
 * change to the mobile number. When the box is cleared the field keeps the number it showed and becomes independent.
 * Nothing about the choice is stored: only the final WhatsApp number is saved.
 */
export const whatsappValue = (same: boolean, phone: string, whatsapp: string): string => (same ? phone : whatsapp);

/** The digits that identify a mobile number (ignores spaces, dashes, brackets, +91 / 0 prefixes), to compare two numbers. */
export function mobileDigits(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** Editing an existing record: the box starts ticked when the saved WhatsApp number is empty or is the mobile number. */
export const startsSameAsMobile = (phone: string | null | undefined, whatsapp: string | null | undefined): boolean =>
  !String(whatsapp ?? '').trim() || mobileDigits(whatsapp) === mobileDigits(phone);
