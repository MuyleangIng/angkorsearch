package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
)

const stateCookie = "oauth_state"

func generateState() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}

func setStateCookie(c *fiber.Ctx, state string) {
	c.Cookie(&fiber.Cookie{
		Name: stateCookie, Value: state,
		HTTPOnly: true, SameSite: "Lax", MaxAge: 600, Path: "/",
	})
}

func clearStateCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name: stateCookie, Value: "", Expires: time.Unix(0, 0), Path: "/",
	})
}

func (h *Handler) validateState(c *fiber.Ctx) bool {
	cookie := c.Cookies(stateCookie)
	return cookie != "" && cookie == c.Query("state")
}

// ─── Google ───────────────────────────────────────────────────────────────────

// GET /auth/google
func (h *Handler) GoogleLogin(c *fiber.Ctx) error {
	state, err := generateState()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	setStateCookie(c, state)
	return c.Redirect(h.google.AuthCodeURL(state))
}

// GET /auth/google/callback
func (h *Handler) GoogleCallback(c *fiber.Ctx) error {
	if !h.validateState(c) {
		return c.Status(400).JSON(fiber.Map{"error": "invalid state — possible CSRF attack"})
	}
	code := c.Query("code")
	if code == "" {
		return c.Status(400).JSON(fiber.Map{"error": "missing authorization code"})
	}

	token, err := h.google.Exchange(context.Background(), code)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "failed to exchange code with Google"})
	}

	client := h.google.Client(context.Background(), token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil || resp.StatusCode != 200 {
		return c.Status(500).JSON(fiber.Map{"error": "failed to get Google user info"})
	}
	defer resp.Body.Close()

	var info struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to parse Google user info"})
	}

	userID, err := h.linkOAuthProvider(info.Email, info.Name, info.Picture, "google", info.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to save user"})
	}

	sessionID, err := h.createSession(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to create session"})
	}
	setSessionCookie(c, sessionID)
	clearStateCookie(c)
	return c.Redirect(h.cfg.FrontendURL + "/?login=success")
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

// GET /auth/github
func (h *Handler) GitHubLogin(c *fiber.Ctx) error {
	state, err := generateState()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "internal error"})
	}
	setStateCookie(c, state)
	return c.Redirect(h.github.AuthCodeURL(state))
}

// GET /auth/github/callback
func (h *Handler) GitHubCallback(c *fiber.Ctx) error {
	if !h.validateState(c) {
		return c.Status(400).JSON(fiber.Map{"error": "invalid state — possible CSRF attack"})
	}
	code := c.Query("code")
	if code == "" {
		return c.Status(400).JSON(fiber.Map{"error": "missing authorization code"})
	}

	token, err := h.github.Exchange(context.Background(), code)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "failed to exchange code with GitHub"})
	}

	ghUser, err := fetchGitHubUser(token.AccessToken)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to get GitHub user info"})
	}

	// GitHub profiles may hide email — fetch from emails endpoint
	if ghUser.Email == "" {
		ghUser.Email, _ = fetchGitHubPrimaryEmail(token.AccessToken)
	}
	// Final fallback: noreply address
	if ghUser.Email == "" {
		ghUser.Email = fmt.Sprintf("%d+%s@users.noreply.github.com", ghUser.ID, ghUser.Login)
	}

	userID, err := h.linkOAuthProvider(ghUser.Email, ghUser.Login, ghUser.AvatarURL, "github", fmt.Sprintf("%d", ghUser.ID))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to save user"})
	}

	sessionID, err := h.createSession(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to create session"})
	}
	setSessionCookie(c, sessionID)
	clearStateCookie(c)
	return c.Redirect(h.cfg.FrontendURL + "/?login=success")
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

type githubUser struct {
	ID        int    `json:"id"`
	Login     string `json:"login"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

func fetchGitHubUser(token string) (*githubUser, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var u githubUser
	return &u, json.NewDecoder(resp.Body).Decode(&u)
}

func fetchGitHubPrimaryEmail(token string) (string, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user/emails", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := json.Unmarshal(body, &emails); err != nil {
		return "", err
	}
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email, nil
		}
	}
	return "", nil
}
