
import "dotenv/config";
import nodemailer from "nodemailer";

let transporterPromise:
  | ReturnType<typeof nodemailer.createTransport>
  | null = null;

export async function getMailer() {
  if (transporterPromise) {
    return transporterPromise;
  }

  const user = process.env.ETHEREAL_USER;
  const pass = process.env.ETHEREAL_PASS;

  if (user && pass) {
    transporterPromise = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user, pass },
    });
  } else {
    const account = await nodemailer.createTestAccount();

    console.log("Ethereal test account:", account.user);

    transporterPromise = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });
  }

  return transporterPromise;
}
