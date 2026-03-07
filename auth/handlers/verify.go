package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"

	"angkorsearch/auth/mail"
	"angkorsearch/auth/models"
)

// POST /auth/verify-email   body: {"token": "..."}
// Used by frontend SPA after user clicks the link in email.
func (h *Handler) VerifyEmail(c *fiber.Ctx) error {
	var body struct {
		Token string `json:"token"`
	}
	if err := c.BodyParser(&body); err != nil || body.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "token required"})
	}

	var userID int
	var expiresAt time.Time
	err := h.db.QueryRow(context.Background(),
		`SELECT user_id, expires_at FROM email_verifications WHERE token = $1`, body.Token,
	).Scan(&userID, &expiresAt)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid or expired token"})
	}
	if time.Now().After(expiresAt) {
		h.db.Exec(context.Background(), `DELETE FROM email_verifications WHERE user_id = $1`, userID)
		return c.Status(400).JSON(fiber.Map{"error": "token has expired — request a new one"})
	}

	h.db.Exec(context.Background(),
		`UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`, userID,
	)
	h.db.Exec(context.Background(), `DELETE FROM email_verifications WHERE user_id = $1`, userID)

	return c.JSON(fiber.Map{"message": "email verified successfully"})
}

// GET /auth/verify-email?token=xxx
// Direct link from email — verifies then redirects to frontend.
func (h *Handler) VerifyEmailLink(c *fiber.Ctx) error {
	token := c.Query("token")
	if token == "" {
		return c.Redirect(h.cfg.FrontendURL + "/verify-email?error=missing_token")
	}

	var userID int
	var expiresAt time.Time
	err := h.db.QueryRow(context.Background(),
		`SELECT user_id, expires_at FROM email_verifications WHERE token = $1`, token,
	).Scan(&userID, &expiresAt)

	if err != nil || time.Now().After(expiresAt) {
		h.db.Exec(context.Background(), `DELETE FROM email_verifications WHERE token = $1`, token)
		return c.Redirect(h.cfg.FrontendURL + "/verify-email?error=invalid_token")
	}

	h.db.Exec(context.Background(),
		`UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`, userID,
	)
	h.db.Exec(context.Background(), `DELETE FROM email_verifications WHERE token = $1`, token)
	return c.Redirect(h.cfg.FrontendURL + "/verify-email?success=true")
}

// POST /auth/resend-verification   (requires auth)
func (h *Handler) ResendVerification(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	if user.EmailVerified {
		return c.Status(400).JSON(fiber.Map{"error": "email is already verified"})
	}

	// Delete any existing token first
	h.db.Exec(context.Background(), `DELETE FROM email_verifications WHERE user_id = $1`, user.ID)

	if err := h.sendVerificationEmail(user.ID, user.Email, user.Username); err != nil {
		log.Printf("warn: resend verification failed for %s: %v", user.Email, err)
		return c.Status(500).JSON(fiber.Map{"error": "failed to send verification email"})
	}
	return c.JSON(fiber.Map{"message": "verification email sent"})
}

// ─── helper used by Register and ResendVerification ──────────────────────────

func (h *Handler) sendVerificationEmail(userID int, email, username string) error {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	token := hex.EncodeToString(b)

	_, err := h.db.Exec(context.Background(), `
		INSERT INTO email_verifications (user_id, token, expires_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		    SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
	`, userID, token, time.Now().Add(24*time.Hour))
	if err != nil {
		return err
	}

	verifyURL := h.cfg.FrontendURL + "/verify-email?token=" + token
	return h.mailer.Send(email, "Verify your AngkorSearch email", mail.VerifyEmailHTML(username, verifyURL))
}
