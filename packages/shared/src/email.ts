export type EmailBrand = { name: string; logoUrl: string | null };
export const defaultEmailBrand: EmailBrand = {
  name: 'SitePulse',
  logoUrl: null,
};

// Logos are loaded by recipients, never fetched or proxied by our servers.
export function validLogoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      !/\s/.test(value) &&
      ![...value].some((character) => character.charCodeAt(0) < 32) &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      !/\.(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}
export function emailHtml(input: {
  brand: EmailBrand;
  title: string;
  text: string;
  actionUrl: string;
  actionLabel: string;
  status?: 'attention' | 'success' | 'info';
}) {
  const { brand, title, text, actionUrl, actionLabel, status = 'info' } = input;
  const color =
    status === 'attention'
      ? '#a32222'
      : status === 'success'
        ? '#17663b'
        : '#185abc';
  const safeAction = /^https?:\/\//i.test(actionUrl) ? escape(actionUrl) : '#';
  const logo =
    brand.logoUrl && validLogoUrl(brand.logoUrl)
      ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.name)}" width="180" style="display:block;max-width:180px;max-height:64px;width:auto;height:auto;border:0;margin-bottom:16px">`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="margin:0;background:#f3f6fa;color:#17243b;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d7dfea;border-radius:14px"><tr><td style="padding:28px 24px;border-bottom:1px solid #d7dfea">${logo}<div style="font-size:20px;font-weight:700;overflow-wrap:anywhere">${escape(brand.name)}</div></td></tr><tr><td style="padding:28px 24px"><div style="font-size:12px;font-weight:700;letter-spacing:1px;color:${color};margin-bottom:12px">${status === 'attention' ? 'NEEDS ATTENTION' : status === 'success' ? 'CONFIRMED' : 'ACCOUNT & NOTIFICATIONS'}</div><h1 style="font-size:26px;line-height:1.3;margin:0 0 20px;overflow-wrap:anywhere">${escape(title)}</h1><div style="font-size:15px;line-height:1.7;overflow-wrap:anywhere">${escape(text).replace(/\n/g, '<br>')}</div><table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td bgcolor="#185abc" style="border-radius:8px"><a href="${safeAction}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none">${escape(actionLabel)}</a></td></tr></table><p style="font-size:12px;line-height:1.6;color:#516079;margin:24px 0 0;overflow-wrap:anywhere">If the button does not work, copy the link:<br><a href="${safeAction}" style="color:#185abc">${safeAction}</a></p></td></tr></table><p style="font-size:12px;color:#516079;line-height:1.6">${escape(brand.name)} · Automated email<br>Please do not reply to this message.</p></td></tr></table></body></html>`;
}
