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

	"angkorsearch/auth/middleware"
	"angkorsearch/auth/models"
)

const sessionDuration = 7 * 24 * time.Hour

// POST /auth/register
func (h *Handler) Register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	body.Email    = strings.TrimSpace(strings.ToLower(body.Email))
	body.Username = strings.TrimSpace(body.Username)

	if body.Email == "" || body.Password == "" || body.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "email, username, and password are required"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "password must be at least 8 characters"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}

	var userID int
	err = h.db.QueryRow(context.Background(),
		`INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		body.Email, body.Username, string(hash),
	).Scan(&userID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			return c.Status(409).JSON(fiber.Map{"error": "email already registered"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "failed to create user"})
	}

	sessionID, err := h.createSession(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to create session"})
	}
	setSessionCookie(c, sessionID)

	// Send verification email asynchronously — don't block the response
	go func(uid int, email, username string) {
		if err := h.sendVerificationEmail(uid, email, username); err != nil {
			log.Printf("warn: verification email failed for %s: %v", email, err)
		}
	}(userID, body.Email, body.Username)

	return c.Status(201).JSON(fiber.Map{
		"id": userID, "email": body.Email, "username": body.Username,
		"role": "user", "email_verified": false,
	})
}

// POST /auth/login
func (h *Handler) Login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	var user models.User
	var passwordHash string

	err := h.db.QueryRow(context.Background(), `
		SELECT u.id, u.email, u.username, u.avatar_url,
		       u.bio, u.website, u.location,
		       r.name, u.is_active, u.email_verified,
		       u.google_id IS NOT NULL, u.github_id IS NOT NULL,
		       u.created_at, COALESCE(u.password_hash, '')
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.email = $1
	`, body.Email).Scan(
		&user.ID, &user.Email, &user.Username, &user.AvatarURL,
		&user.Bio, &user.Website, &user.Location,
		&user.Role, &user.IsActive, &user.EmailVerified,
		&user.HasGoogle, &user.HasGitHub,
		&user.CreatedAt, &passwordHash,
	)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid email or password"})
	}
	if !user.IsActive {
		return c.Status(403).JSON(fiber.Map{"error": "account has been deactivated"})
	}
	if passwordHash == "" {
		return c.Status(401).JSON(fiber.Map{"error": "this account uses social login (Google or GitHub)"})
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid email or password"})
	}

	h.db.Exec(context.Background(), `UPDATE users SET last_login = NOW() WHERE id = $1`, user.ID)

	sessionID, err := h.createSession(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to create session"})
	}
	setSessionCookie(c, sessionID)

	user.Permissions = h.perms.Get(user.Role)
	return c.JSON(&user)
}

// POST /auth/logout
func (h *Handler) Logout(c *fiber.Ctx) error {
	sessionID := c.Cookies(middleware.SessionCookie)
	if sessionID != "" {
		h.db.Exec(context.Background(), `DELETE FROM sessions WHERE id = $1`, sessionID)
	}
	c.Cookie(&fiber.Cookie{
		Name: middleware.SessionCookie, Value: "",
		Expires: time.Unix(0, 0), HTTPOnly: true, SameSite: "Lax", Path: "/",
	})
	return c.JSON(fiber.Map{"message": "logged out"})
}

// GET /auth/me
func (h *Handler) Me(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	return c.JSON(user)
}

// PUT /auth/profile — update username, bio, website, location
func (h *Handler) UpdateProfile(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	var body struct {
		Username string `json:"username"`
		Bio      string `json:"bio"`
		Website  string `json:"website"`
		Location string `json:"location"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	body.Username = strings.TrimSpace(body.Username)
	if body.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "username cannot be empty"})
	}
	_, err := h.db.Exec(context.Background(),
		`UPDATE users SET username = $1, bio = $2, website = $3, location = $4, updated_at = NOW() WHERE id = $5`,
		body.Username, strings.TrimSpace(body.Bio),
		strings.TrimSpace(body.Website), strings.TrimSpace(body.Location),
		user.ID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to update profile"})
	}
	return c.JSON(fiber.Map{"message": "profile updated"})
}

// PUT /auth/password — change own password (requires current password)
func (h *Handler) ChangePassword(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if len(body.NewPassword) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "new password must be at least 8 characters"})
	}

	var currentHash string
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(password_hash, '') FROM users WHERE id = $1`, user.ID,
	).Scan(&currentHash)

	if currentHash == "" {
		return c.Status(400).JSON(fiber.Map{"error": "social login accounts have no password to change"})
	}
	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(body.CurrentPassword)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "current password is incorrect"})
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	h.db.Exec(context.Background(),
		`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
		string(newHash), user.ID,
	)

	// Invalidate all other sessions for this user
	sessionID := c.Cookies(middleware.SessionCookie)
	h.db.Exec(context.Background(),
		`DELETE FROM sessions WHERE user_id = $1 AND id != $2`, user.ID, sessionID,
	)
	return c.JSON(fiber.Map{"message": "password changed, other sessions logged out"})
}

// DELETE /auth/account — user deletes their own account
func (h *Handler) DeleteAccount(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)
	var body struct {
		Password string `json:"password"` // required for local accounts
	}
	c.BodyParser(&body)

	var currentHash string
	h.db.QueryRow(context.Background(),
		`SELECT COALESCE(password_hash, '') FROM users WHERE id = $1`, user.ID,
	).Scan(&currentHash)

	// Local account must confirm with password
	if currentHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(body.Password)); err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "incorrect password"})
		}
	}

	// ON DELETE CASCADE handles sessions, bookmarks, search_history
	h.db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID)

	c.Cookie(&fiber.Cookie{
		Name: middleware.SessionCookie, Value: "",
		Expires: time.Unix(0, 0), HTTPOnly: true, SameSite: "Lax", Path: "/",
	})
	return c.JSON(fiber.Map{"message": "account deleted"})
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func (h *Handler) createSession(userID int) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	id := hex.EncodeToString(b)
	_, err := h.db.Exec(context.Background(),
		`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
		id, userID, time.Now().Add(sessionDuration),
	)
	return id, err
}

func setSessionCookie(c *fiber.Ctx, id string) {
	c.Cookie(&fiber.Cookie{
		Name:     middleware.SessionCookie,
		Value:    id,
		HTTPOnly: true,
		SameSite: "Lax",
		MaxAge:   int(sessionDuration.Seconds()),
		Path:     "/",
	})
}

// linkOAuthProvider upserts a user from Google/GitHub OAuth.
// Logic: find by providerID → find by email (link) → create new.
// col is always "google_id" or "github_id" — never user input, safe to interpolate.
func (h *Handler) linkOAuthProvider(email, username, avatarURL, provider, providerID string) (int, error) {
	ctx := context.Background()
	col := "google_id"
	if provider == "github" {
		col = "github_id"
	}

	// 1. Returning OAuth user
	var userID int
	err := h.db.QueryRow(ctx, `SELECT id FROM users WHERE `+col+` = $1`, providerID).Scan(&userID)
	if err == nil {
		h.db.Exec(ctx,
			`UPDATE users SET avatar_url = $1, last_login = NOW(), updated_at = NOW() WHERE id = $2`,
			avatarURL, userID,
		)
		return userID, nil
	}

	// 2. Existing user by email — link the provider to their account
	err = h.db.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&userID)
	if err == nil {
		h.db.Exec(ctx,
			`UPDATE users SET `+col+` = $1, avatar_url = $2, last_login = NOW(), updated_at = NOW() WHERE id = $3`,
			providerID, avatarURL, userID,
		)
		return userID, nil
	}

	// 3. Brand new user — OAuth accounts are pre-verified (email verified by provider)
	err = h.db.QueryRow(ctx,
		`INSERT INTO users (email, username, avatar_url, `+col+`, email_verified) VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
		email, username, avatarURL, providerID,
	).Scan(&userID)
	return userID, err
}
