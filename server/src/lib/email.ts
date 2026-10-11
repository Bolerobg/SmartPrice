import { env, features } from '../env.js';
import { AppError } from './errors.js';

/**
 * Изпращане на имейли през Resend (HTTP API, без допълнителна зависимост).
 *
 * Ако RESEND_API_KEY липсва, функциите хвърлят ясна грешка вместо да се
 * преструват, че имейлът е изпратен.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

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
      SmartPrice — споделяне на реални цени · <a href="https://smart.lookthis.online" style="color:#475569;text-decoration:none;">smart.lookthis.online</a>
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
      `smart.lookthis.online`,
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
      `smart.lookthis.online`,
  });
}
