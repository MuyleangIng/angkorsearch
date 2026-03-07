package mail

import (
	"crypto/tls"
	"log"

	"gopkg.in/gomail.v2"

	"angkorsearch/auth/config"
)

// Mailer wraps gomail for sending HTML emails via SMTP.
// If SMTP_HOST is not set, all Send() calls are silent no-ops.
type Mailer struct {
	dialer  *gomail.Dialer
	from    string
	enabled bool
}

func New(cfg *config.Config) *Mailer {
	if cfg.SMTPHost == "" {
		log.Println("warn: SMTP_HOST not set — email sending disabled")
		return &Mailer{enabled: false}
	}
	d := gomail.NewDialer(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass)
	if cfg.SMTPPort == 465 {
		d.SSL = true
	}
	d.TLSConfig = &tls.Config{ServerName: cfg.SMTPHost}
	return &Mailer{dialer: d, from: cfg.SMTPFrom, enabled: true}
}

// Send sends an HTML email. Returns nil silently if SMTP is not configured.
func (m *Mailer) Send(to, subject, body string) error {
	if !m.enabled {
		return nil
	}
	msg := gomail.NewMessage()
	msg.SetHeader("From", m.from)
	msg.SetHeader("To", to)
	msg.SetHeader("Subject", subject)
	msg.SetBody("text/html", body)
	return m.dialer.DialAndSend(msg)
}

// ─── Email templates ──────────────────────────────────────────────────────────

func VerifyEmailHTML(username, verifyURL string) string {
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f0f0f0">
<div style="background:#fff;border-radius:10px;padding:36px;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <h1 style="color:#1a1a2e;margin:0 0 4px">AngkorSearch 🇰🇭</h1>
  <p style="color:#888;margin:0 0 28px;font-size:14px">Cambodia's Open Search Engine</p>
  <hr style="border:none;border-top:1px solid #eee;margin-bottom:28px">
  <h2 style="color:#1a1a2e">Hi ` + username + `, verify your email</h2>
  <p style="color:#555;line-height:1.7">Thanks for registering! Click the button below to verify your email address and activate your account.</p>
  <a href="` + verifyURL + `" style="display:inline-block;background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin:20px 0;font-size:16px">
    Verify My Email
  </a>
  <p style="color:#999;font-size:13px">This link expires in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0 16px">
  <p style="color:#bbb;font-size:12px">Or paste this link in your browser:<br>` + verifyURL + `</p>
</div></body></html>`
}

func ResetPasswordHTML(username, resetURL string) string {
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f0f0f0">
<div style="background:#fff;border-radius:10px;padding:36px;box-shadow:0 2px 12px rgba(0,0,0,.1)">
  <h1 style="color:#1a1a2e;margin:0 0 4px">AngkorSearch 🇰🇭</h1>
  <p style="color:#888;margin:0 0 28px;font-size:14px">Cambodia's Open Search Engine</p>
  <hr style="border:none;border-top:1px solid #eee;margin-bottom:28px">
  <h2 style="color:#1a1a2e">Password Reset Request</h2>
  <p style="color:#555;line-height:1.7">Hi <strong>` + username + `</strong>, we received a request to reset your AngkorSearch password. Click the button below to set a new password.</p>
  <a href="` + resetURL + `" style="display:inline-block;background:#e53e3e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin:20px 0;font-size:16px">
    Reset My Password
  </a>
  <p style="color:#999;font-size:13px">This link expires in <strong>1 hour</strong>. If you did not request a password reset, ignore this email — your password will not change.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0 16px">
  <p style="color:#bbb;font-size:12px">Or paste this link in your browser:<br>` + resetURL + `</p>
</div></body></html>`
}
