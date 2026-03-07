package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"golang.org/x/crypto/bcrypt"

	"angkorsearch/auth/mail"
	"angkorsearch/auth/middleware"
	"angkorsearch/auth/models"
)

// POST /auth/forgot-password   body: {"email": "..."}
// Always returns the same response — never reveals if an email exists.
func (h *Handler) ForgotPassword(c *fiber.Ctx) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "email required"})
	}

	// Find local account (OAuth accounts don't need password reset)
	var userID int
	var username string
	err := h.db.QueryRow(context.Background(),
		`SELECT id, username FROM users WHERE email = $1 AND password_hash IS NOT NULL`, body.Email,
	).Scan(&userID, &username)

	if err == nil {
		// Generate reset token
		b := make([]byte, 32)
		rand.Read(b)
		token := hex.EncodeToString(b)

		h.db.Exec(context.Background(), `
			INSERT INTO password_resets (user_id, token, expires_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE
			    SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, used = FALSE
		`, userID, token, time.Now().Add(1*time.Hour))

		resetURL := h.cfg.FrontendURL + "/reset-password?token=" + token
		go func() {
			if err := h.mailer.Send(body.Email, "Reset your AngkorSearch password",
				mail.ResetPasswordHTML(username, resetURL)); err != nil {
				log.Printf("warn: reset email failed for %s: %v", body.Email, err)
			}
		}()
	}

	// Always return the same message (security: don't reveal if email exists)
	return c.JSON(fiber.Map{"message": "if that email is registered, a reset link has been sent"})
}

// POST /auth/reset-password   body: {"token": "...", "password": "..."}
func (h *Handler) ResetPassword(c *fiber.Ctx) error {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"new_password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if body.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "token required"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "password must be at least 8 characters"})
	}

	var userID int
	var expiresAt time.Time
	var used bool
	err := h.db.QueryRow(context.Background(),
		`SELECT user_id, expires_at, used FROM password_resets WHERE token = $1`, body.Token,
	).Scan(&userID, &expiresAt, &used)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid or expired reset token"})
	}
	if used {
		return c.Status(400).JSON(fiber.Map{"error": "reset token has already been used"})
	}
	if time.Now().After(expiresAt) {
		h.db.Exec(context.Background(), `DELETE FROM password_resets WHERE user_id = $1`, userID)
		return c.Status(400).JSON(fiber.Map{"error": "reset token has expired — request a new one"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	// Update password
	h.db.Exec(context.Background(),
		`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
		string(hash), userID,
	)
	// Mark token as used (keep record for audit)
	h.db.Exec(context.Background(),
		`UPDATE password_resets SET used = TRUE WHERE user_id = $1`, userID,
	)
	// Revoke all sessions — force re-login with new password
	h.db.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)

	return c.JSON(fiber.Map{"message": "password reset successful — please log in with your new password"})
}

// POST /auth/logout-all   (authenticated) — revoke all sessions except current
func (h *Handler) LogoutAllDevices(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	currentSession := c.Cookies(middleware.SessionCookie)

	res, _ := h.db.Exec(context.Background(),
		`DELETE FROM sessions WHERE user_id = $1 AND id != $2`, user.ID, currentSession,
	)
	return c.JSON(fiber.Map{
		"message": "logged out of all other devices",
		"count":   res.RowsAffected(),
	})
}
