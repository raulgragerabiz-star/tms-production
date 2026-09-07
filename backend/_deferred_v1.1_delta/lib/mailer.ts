import nodemailer from "nodemailer";

/**
 * Wrapper mínimo sobre nodemailer con SMTP genérico — funciona con
 * cualquier proveedor (SendGrid, SES, Mailgun, un servidor SMTP interno)
 * sin acoplar el resto del código a un SDK propietario concreto. Mismo
 * principio de adaptador ya aplicado a las integraciones externas
 * (03-arquitectura-TMS.md §8: "diseñadas como adaptadores... el núcleo no
 * debe acoplarse a ningún sistema externo concreto").
 */

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

export interface SendReportEmailParams {
  to: string[];
  subject: string;
  bodyText: string;
  attachment: { filename: string; content: Buffer | string; contentType: string };
}

export async function sendReportEmail(params: SendReportEmailParams): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn(
      "[mailer] SMTP_HOST no configurado — informe generado pero NO enviado. " +
        "Configura SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD para activar el envío real."
    );
    return;
  }

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? "tms@example.com",
    to: params.to.join(", "),
    subject: params.subject,
    text: params.bodyText,
    attachments: [
      {
        filename: params.attachment.filename,
        content: params.attachment.content,
        contentType: params.attachment.contentType,
      },
    ],
  });
}
