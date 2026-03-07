package middleware

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"angkorsearch/auth/db"
	"angkorsearch/auth/models"
)

const SessionCookie = "angkor_session"

// RequireAuth validates the session cookie, loads the user + permissions into context.
func RequireAuth(pool *pgxpool.Pool, ps *db.PermissionStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		sessionID := c.Cookies(SessionCookie)
		if sessionID == "" {
			return c.Status(401).JSON(fiber.Map{"error": "not authenticated"})
		}

		var user models.User
		var expiresAt time.Time

		err := pool.QueryRow(context.Background(), `
			SELECT u.id, u.email, u.username, u.avatar_url,
			       u.bio, u.website, u.location,
			       r.name, u.is_active, u.email_verified,
			       u.google_id IS NOT NULL,
			       u.github_id IS NOT NULL,
			       u.created_at, s.expires_at
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			JOIN roles  r ON r.id = u.role_id
			WHERE s.id = $1
		`, sessionID).Scan(
			&user.ID, &user.Email, &user.Username, &user.AvatarURL,
			&user.Bio, &user.Website, &user.Location,
			&user.Role, &user.IsActive, &user.EmailVerified,
			&user.HasGoogle, &user.HasGitHub,
			&user.CreatedAt, &expiresAt,
		)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "invalid session"})
		}

		if time.Now().After(expiresAt) {
			pool.Exec(context.Background(), `DELETE FROM sessions WHERE id = $1`, sessionID)
			return c.Status(401).JSON(fiber.Map{"error": "session expired"})
		}

		if !user.IsActive {
			return c.Status(403).JSON(fiber.Map{"error": "account is deactivated"})
		}

		user.Permissions = ps.Get(user.Role)
		c.Locals("user", &user)
		return c.Next()
	}
}

// RequireRole allows only users whose role matches one of the given role names.
func RequireRole(roles ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals("user").(*models.User)
		if !ok || user == nil {
			return c.Status(401).JSON(fiber.Map{"error": "not authenticated"})
		}
		for _, r := range roles {
			if user.Role == r {
				return c.Next()
			}
		}
		return c.Status(403).JSON(fiber.Map{"error": "insufficient role"})
	}
}

// RequirePermission allows only users who have the given RBAC permission.
func RequirePermission(perm string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals("user").(*models.User)
		if !ok || user == nil {
			return c.Status(401).JSON(fiber.Map{"error": "not authenticated"})
		}
		if !user.HasPermission(perm) {
			return c.Status(403).JSON(fiber.Map{"error": "permission denied: " + perm})
		}
		return c.Next()
	}
}
