import { env, features } from '../env.js';
import { AppError } from './errors.js';

/**
 * Изпращане на имейли през Resend (HTTP API, без допълнителна зависимост).
 *
 * Ако RESEND_API_KEY липсва, функциите хвърлят ясна грешка вместо да се
 * преструват, че имейлът е изпратен.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Публичният адрес идва от PUBLIC_BASE_URL — при смяна на домейна се
// променя само .env, не кодът.
const APP_URL = env.PUBLIC_BASE_URL.replace(/\/+$/, '');
const APP_HOST = APP_URL.replace(/^https?:\/\//, '');

export interface SendResult {
  id: string;
}

async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!features.mail) {
    throw new AppError(
      503,
      'mail_not_configured',
      'Изпращането на имейли не е конфигурирано на сървъра (липсва RESEND_API_KEY).'
    );
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    // Не показваме суровото тяло на потребителя, но го логваме за диагностика.
    // eslint-disable-next-line no-console
    console.error(`[mail] Resend върна ${response.status}: ${body.slice(0, 400)}`);
    throw new AppError(
      502,
      'mail_failed',
      'Не успях да изпратя имейла. Опитай отново след малко.'
    );
  }

  const data = (await response.json()) as { id?: string };
  return { id: data.id ?? 'unknown' };
}

/** Обвивката на писмото — тъмна, в стила на приложението. */
function layout(params: {
  preheader: string;
  heading: string;
  intro: string;
  code: string;
  footnote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmartPrice</title>
</head>
<body style="margin:0;padding:0;background:#0B0F1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#0B0F1A;max-height:0;overflow:hidden;">${params.preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F1A;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#131A2B;border:1px solid #233049;border-radius:20px;overflow:hidden;">

      <!-- Лента отгоре -->
      <tr><td style="height:5px;background:linear-gradient(90deg,#6366F1 0%,#06B6D4 50%,#FBBF24 100%);"></td></tr>

      <!-- Лого -->
      <tr><td style="padding:32px 32px 8px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:26px;line-height:1;">🛒</td>
          <td style="padding-left:10px;font-size:21px;font-weight:800;color:#F8FAFC;letter-spacing:-0.4px;">
            SmartPrice
          </td>
        </tr></table>
      </td></tr>

      <!-- Заглавие -->
      <tr><td style="padding:14px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:800;color:#F8FAFC;">
          ${params.heading}
        </h1>
      </td></tr>

      <!-- Обяснение -->
      <tr><td style="padding:10px 32px 0 32px;">
        <p style="margin:0;font-size:15px;line-height:1.6;color:#94A3B8;">
          ${params.intro}
        </p>
      </td></tr>

      <!-- Кодът -->
      <tr><td style="padding:26px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:#0B0F1A;border:1px solid #2A3A5C;border-radius:16px;">
          <tr><td align="center" style="padding:24px 16px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;color:#64748B;text-transform:uppercase;padding-bottom:10px;">
              Твоят код
            </div>
            <div style="font-family:'SF Mono',Consolas,Monaco,monospace;font-size:40px;font-weight:800;letter-spacing:10px;color:#FBBF24;padding-left:10px;">
              ${params.code}
            </div>
          </td></tr>
        </table>
      </td></tr>

      <!-- Бележка -->
      <tr><td style="padding:18px 32px 0 32px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#64748B;">
          ${params.footnote}
        </p>
      </td></tr>

      <!-- Разделител -->
      <tr><td style="padding:26px 32px 0 32px;">
        <div style="height:1px;background:#233049;"></div>
      </td></tr>

      <!-- Долен колонтитул -->
      <tr><td style="padding:18px 32px 30px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.7;color:#475569;">
          Ако не си поискал това писмо, просто го игнорирай — нищо няма да се промени.<br>
          Този имейл е изпратен автоматично, не отговаряй на него.
        </p>
      </td></tr>

    </table>

    <p style="margin:18px 0 0 0;font-size:11px;color:#334155;">
      SmartPrice — споделяне на реални цени · <a href="${APP_URL}" style="color:#475569;text-decoration:none;">${APP_HOST}</a>
    </p>
  </td></tr>
</table>
</body>
</html>`;
}

/** Писмо с код за потвърждение на нов профил. */
export async function sendVerificationEmail(params: {
  to: string;
  code: string;
  name: string;
}): Promise<SendResult> {
  const html = layout({
    preheader: `Кодът ти за потвърждение е ${params.code}`,
    heading: `Добре дошъл, ${params.name}! 👋`,
    intro:
      'Остава една стъпка, за да започнеш да споделяш и откриваш реални цени. Въведи този код в приложението:',
    code: params.code,
    footnote:
      'Кодът е валиден <strong style="color:#94A3B8;">15 минути</strong> и може да се използва само веднъж.',
  });

  return sendMail({
    to: params.to,
    subject: `${params.code} е твоят код за SmartPrice`,
    html,
    text:
      `Добре дошъл в SmartPrice, ${params.name}!\n\n` +
      `Твоят код за потвърждение е: ${params.code}\n\n` +
      `Кодът е валиден 15 минути и може да се използва само веднъж.\n` +
      `Ако не си се регистрирал, игнорирай това писмо.\n\n` +
      `${APP_HOST}`,
  });
}

/** Писмо с код за смяна на забравена парола. */
export async function sendPasswordResetEmail(params: {
  to: string;
  code: string;
  name: string;
}): Promise<SendResult> {
  const html = layout({
    preheader: `Кодът ти за нова парола е ${params.code}`,
    heading: 'Нова парола 🔐',
    intro:
      'Получихме заявка за смяна на паролата на твоя профил. Въведи този код в приложението, за да зададеш нова:',
    code: params.code,
    footnote:
      'Кодът е валиден <strong style="color:#94A3B8;">15 минути</strong>. Ако ти не си поискал смяна, не прави нищо — паролата остава непроменена.',
  });

  return sendMail({
    to: params.to,
    subject: `${params.code} е твоят код за нова парола`,
    html,
    text:
      `Заявка за нова парола за SmartPrice.\n\n` +
      `Твоят код е: ${params.code}\n\n` +
      `Кодът е валиден 15 минути.\n` +
      `Ако не си поискал смяна, игнорирай това писмо — паролата остава същата.\n\n` +
      `${APP_HOST}`,
  });
}

/* ------------------------------------------------------------------ */
/*  Писма от админа: спиране на профил, изтриване, аларма            */
/* ------------------------------------------------------------------ */

/** Обикновена обвивка (заглавие + текст), без голям код. */
function plainLayout(params: { heading: string; intro: string; bodyHtml: string; footnote: string }): string {
  return `<!DOCTYPE html>
<html lang="bg">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartPrice</title></head>
<body style="margin:0;padding:0;background:#0B0F1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0F1A;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#131A2B;border:1px solid #233049;border-radius:20px;overflow:hidden;">
      <tr><td style="height:5px;background:linear-gradient(90deg,#6366F1 0%,#06B6D4 50%,#FBBF24 100%);"></td></tr>
      <tr><td style="padding:28px 30px 6px 30px;font-size:20px;font-weight:800;color:#F8FAFC;">
        🛒 SmartPrice
      </td></tr>
      <tr><td style="padding:8px 30px 0 30px;">
        <h1 style="margin:0;font-size:21px;line-height:1.35;font-weight:800;color:#F8FAFC;">${params.heading}</h1>
      </td></tr>
      <tr><td style="padding:10px 30px 0 30px;">
        <p style="margin:0;font-size:15px;line-height:1.65;color:#94A3B8;">${params.intro}</p>
      </td></tr>
      <tr><td style="padding:16px 30px 0 30px;">
        <div style="font-size:14.5px;line-height:1.7;color:#CBD5E1;">${params.bodyHtml}</div>
      </td></tr>
      <tr><td style="padding:20px 30px 0 30px;">
        <p style="margin:0;font-size:12.5px;line-height:1.65;color:#64748B;">${params.footnote}</p>
      </td></tr>
      <tr><td style="padding:22px 30px 28px 30px;">
        <div style="height:1px;background:#233049;margin-bottom:14px;"></div>
        <p style="margin:0;font-size:11.5px;line-height:1.7;color:#475569;">
          SmartPrice — споделяне на реални цени ·
          <a href="${APP_URL}" style="color:#64748B;text-decoration:none;">${APP_HOST}</a><br>
          Този имейл е изпратен автоматично, не отговаряй на него.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Писмо до потребител, чийто профил е спрян временно. */
export async function sendAccountSuspendedEmail(params: {
  to: string;
  name: string;
  reason: string;
  until?: string | null;
}): Promise<SendResult> {
  const untilText = params.until
    ? `Профилът е спрян до <strong style="color:#F8FAFC;">${escapeHtml(params.until)}</strong>. След тази дата ще можеш да влезеш отново.`
    : 'Профилът е спрян за неопределено време.';

  const html = plainLayout({
    heading: 'Профилът ти е спрян временно ⏸️',
    intro: `Здравей, ${escapeHtml(params.name)}. Профилът ти в SmartPrice е спрян временно от администратор.`,
    bodyHtml: `
      <div style="background:#0B0F1A;border:1px solid #2A3A5C;border-radius:14px;padding:16px;">
        <div style="font-size:11.5px;font-weight:800;letter-spacing:1.4px;color:#64748B;text-transform:uppercase;padding-bottom:8px;">
          Причина
        </div>
        <div style="font-size:15px;color:#FBBF24;font-weight:700;">${escapeHtml(params.reason)}</div>
      </div>
      <p style="margin:14px 0 0 0;">${untilText}</p>
      <p style="margin:12px 0 0 0;">Докато профилът е спрян, не можеш да влизаш и офертите ти не се виждат в приложението.</p>`,
    footnote:
      'Ако смяташ, че има грешка, отговори на този имейл или пиши на екипа на SmartPrice.',
  });

  return sendMail({
    to: params.to,
    subject: 'SmartPrice: профилът ти е спрян временно',
    html,
    text:
      `Здравей, ${params.name}.\n\n` +
      `Профилът ти в SmartPrice е спрян временно.\n` +
      `Причина: ${params.reason}\n` +
      (params.until ? `Срок: до ${params.until}\n` : 'Срок: неопределен\n') +
      `\nДокато е спрян, не можеш да влизаш и офертите ти не се виждат.\n\n` +
      `${APP_HOST}`,
  });
}

/** Писмо до потребител, чийто профил е изтрит. */
export async function sendAccountDeletedEmail(params: {
  to: string;
  name: string;
  reason: string;
}): Promise<SendResult> {
  const html = plainLayout({
    heading: 'Профилът ти е изтрит',
    intro: `Здравей, ${escapeHtml(params.name)}. Профилът ти в SmartPrice беше изтрит от администратор.`,
    bodyHtml: `
      <div style="background:#0B0F1A;border:1px solid #2A3A5C;border-radius:14px;padding:16px;">
        <div style="font-size:11.5px;font-weight:800;letter-spacing:1.4px;color:#64748B;text-transform:uppercase;padding-bottom:8px;">
          Причина
        </div>
        <div style="font-size:15px;color:#F87171;font-weight:700;">${escapeHtml(params.reason)}</div>
      </div>
      <p style="margin:14px 0 0 0;">Офертите и коментарите ти вече не се показват. Ако искаш да ползваш SmartPrice отново, можеш да си направиш нов профил.</p>`,
    footnote: 'Това писмо е изпратено, защото профилът ти беше изтрит по решение на екипа.',
  });

  return sendMail({
    to: params.to,
    subject: 'SmartPrice: профилът ти е изтрит',
    html,
    text:
      `Здравей, ${params.name}.\n\n` +
      `Профилът ти в SmartPrice беше изтрит.\n` +
      `Причина: ${params.reason}\n\n` +
      `Офертите и коментарите ти вече не се показват.\n\n` +
      `${APP_HOST}`,
  });
}

/** Писмо до админа при ненормална активност в приложението. */
export async function sendAdminAlertEmail(params: {
  to: string;
  title: string;
  severity: string;
  kind: string;
  details: Record<string, unknown>;
}): Promise<SendResult> {
  const color =
    params.severity === 'critical' ? '#F87171' : params.severity === 'warning' ? '#FBBF24' : '#06B6D4';

  const rows = Object.entries(params.details)
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:6px 10px;font-size:13px;color:#64748B;white-space:nowrap;">${escapeHtml(k)}</td>
           <td style="padding:6px 10px;font-size:13.5px;color:#F8FAFC;font-weight:600;">${escapeHtml(
             typeof v === 'object' ? JSON.stringify(v) : String(v)
           )}</td>
         </tr>`
    )
    .join('');

  const html = plainLayout({
    heading: `⚠️ ${escapeHtml(params.title)}`,
    intro: 'Следенето за ненормална активност в SmartPrice засече следното:',
    bodyHtml: `
      <div style="background:#0B0F1A;border:1px solid ${color};border-radius:14px;padding:14px;">
        <div style="font-size:11.5px;font-weight:800;letter-spacing:1.4px;color:${color};text-transform:uppercase;padding-bottom:8px;">
          ${escapeHtml(params.severity)} · ${escapeHtml(params.kind)}
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
      </div>
      <p style="margin:14px 0 0 0;">Отвори админ панела, за да видиш подробностите и да реагираш.</p>`,
    footnote: 'Това писмо се праща най-много веднъж на час за един и същ вид събитие.',
  });

  return sendMail({
    to: params.to,
    subject: `[SmartPrice алерт] ${params.title}`,
    html,
    text:
      `${params.title}\n\n` +
      `Вид: ${params.kind} (${params.severity})\n` +
      Object.entries(params.details)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n') +
      `\n\nОтвори админ панела за подробности.`,
  });
}

/* ------------------------------------------------------------------ */
/*  Томболи със спонсор                                              */
/* ------------------------------------------------------------------ */

/** Кой получава писмата за наградите (организаторът). */
function organizerEmail(): string {
  const first = env.ADMIN_EMAILS.split(',').map((e) => e.trim()).filter(Boolean)[0];
  return first ?? env.ALERT_EMAIL;
}

/**
 * Победител в томбола. Писмото трябва да е кратко и да казва ЕДНО нещо:
 * „спечели, влез и дай адрес, иначе наградата отива при следващия“.
 */
export async function sendRaffleWonEmail(params: {
  to: string;
  name: string;
  prizeTitle: string;
  sponsorName: string;
  raffleTitle: string;
  claimDeadlineDays: number;
  deliveryNote: string;
}): Promise<SendResult> {
  const sponsorLine = params.sponsorName
    ? ` Наградата е осигурена от <strong style="color:#F8FAFC;">${escapeHtml(params.sponsorName)}</strong>.`
    : '';
  const html = plainLayout({
    heading: `🎉 Печелиш: ${escapeHtml(params.prizeTitle)}`,
    intro: `Браво, ${escapeHtml(params.name)}! Ти си победителят в „${escapeHtml(params.raffleTitle)}“.`,
    bodyHtml: `
      <p>${sponsorLine}</p>
      <p>За да ти я изпратим, влез в приложението и в екрана на томболата попълни
         име, телефон, град и адрес. Само ти и екипът виждат тези данни.</p>
      <p><strong>Дай данните до ${params.claimDeadlineDays} дни</strong> — след това
         наградата отива при следващия в списъка, за да не увисне.</p>
      ${params.deliveryNote ? `<p>${escapeHtml(params.deliveryNote)}</p>` : ''}`,
    footnote: 'Писмото е автоматично. Ако имаш въпрос, отговори на този имейл.',
  });

  return sendMail({
    to: params.to,
    subject: `🎉 Спечели ${params.prizeTitle}`,
    html,
    text:
      `Браво, ${params.name}! Ти спечели ${params.prizeTitle} в „${params.raffleTitle}“.\n\n` +
      (params.sponsorName ? `Наградата е от ${params.sponsorName}.\n\n` : '') +
      `Влез в SmartPrice и дай име, телефон, град и адрес за доставка до ` +
      `${params.claimDeadlineDays} дни. След това наградата отива при следващия.\n` +
      (params.deliveryNote ? `${params.deliveryNote}\n` : ''),
  });
}

/** Писмо до организатора: готовите данни за куриера, без да ги търси в панела. */
export async function sendRaffleDeliveryEmail(params: {
  winnerName: string;
  winnerHandle: string;
  winnerEmail: string;
  prizeTitle: string;
  sponsorName: string;
  city: string;
  address: string;
  phone: string;
  note: string;
}): Promise<SendResult> {
  const rows = [
    ['Награда', params.prizeTitle],
    ['Спонсор', params.sponsorName || '—'],
    ['Получател', `${params.winnerName} (${params.winnerHandle})`],
    ['Телефон', params.phone],
    ['Град', params.city],
    ['Адрес', params.address],
    ['Бележка', params.note || '—'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="color:#94A3B8;padding:3px 12px 3px 0;">${escapeHtml(k)}</td>` +
        `<td style="color:#F8FAFC;font-weight:700;">${escapeHtml(v)}</td></tr>`
    )
    .join('');

  const html = plainLayout({
    heading: '📦 Победител даде данни за доставка',
    intro: 'Ето какво да дадеш на куриера:',
    bodyHtml: `<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>`,
    footnote: 'Статусът се сменя от админ панела → Томболи → Печалби.',
  });

  return sendMail({
    to: organizerEmail(),
    subject: `📦 Доставка: ${params.prizeTitle} → ${params.winnerName}`,
    html,
    text:
      `Награда: ${params.prizeTitle}\n` +
      `Спонсор: ${params.sponsorName || '—'}\n` +
      `Получател: ${params.winnerName} (${params.winnerHandle})\n` +
      `Телефон: ${params.phone}\nГрад: ${params.city}\nАдрес: ${params.address}\n` +
      `Бележка: ${params.note || '—'}`,
  });
}
