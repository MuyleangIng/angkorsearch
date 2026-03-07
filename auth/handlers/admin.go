package handlers

import (
	"context"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"angkorsearch/auth/models"
)

// GET /admin/users?page=1&limit=20&search=&role=
func (h *Handler) AdminListUsers(c *fiber.Ctx) error {
	page   := max(1, c.QueryInt("page", 1))
	limit  := min(100, max(1, c.QueryInt("limit", 20)))
	search := strings.TrimSpace(c.Query("search"))
	role   := strings.TrimSpace(c.Query("role"))
	offset := (page - 1) * limit

	rows, err := h.db.Query(context.Background(), `
		SELECT u.id, u.email, u.username, u.avatar_url, r.name,
		       u.is_active, u.google_id IS NOT NULL, u.github_id IS NOT NULL,
		       u.created_at, u.last_login
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR r.name = $2)
		ORDER BY u.created_at DESC
		LIMIT $3 OFFSET $4
	`, search, role, limit, offset)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	var users []models.UserListItem
	for rows.Next() {
		var u models.UserListItem
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Username, &u.AvatarURL, &u.Role,
			&u.IsActive, &u.HasGoogle, &u.HasGitHub,
			&u.CreatedAt, &u.LastLogin,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "scan error"})
		}
		users = append(users, u)
	}

	var total int
	h.db.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR r.name = $2)
	`, search, role).Scan(&total)

	if users == nil {
		users = []models.UserListItem{}
	}
	return c.JSON(fiber.Map{"users": users, "total": total, "page": page, "limit": limit})
}

// GET /admin/users/:id
func (h *Handler) AdminGetUser(c *fiber.Ctx) error {
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid user id"})
	}

	var u models.UserListItem
	err = h.db.QueryRow(context.Background(), `
		SELECT u.id, u.email, u.username, u.avatar_url, r.name,
		       u.is_active, u.google_id IS NOT NULL, u.github_id IS NOT NULL,
		       u.created_at, u.last_login
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.id = $1
	`, id).Scan(
		&u.ID, &u.Email, &u.Username, &u.AvatarURL, &u.Role,
		&u.IsActive, &u.HasGoogle, &u.HasGitHub,
		&u.CreatedAt, &u.LastLogin,
	)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	return c.JSON(&u)
}

// PUT /admin/users/:id/role   body: {"role": "admin"|"user"}
func (h *Handler) AdminUpdateRole(c *fiber.Ctx) error {
	requester := c.Locals("user").(*models.User)
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid user id"})
	}
	if requester.ID == id {
		return c.Status(400).JSON(fiber.Map{"error": "cannot change your own role"})
	}

	var body struct {
		Role string `json:"role"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}
	if body.Role != "user" && body.Role != "admin" {
		return c.Status(400).JSON(fiber.Map{"error": "role must be 'user' or 'admin'"})
	}

	var roleID int
	if err := h.db.QueryRow(context.Background(),
		`SELECT id FROM roles WHERE name = $1`, body.Role,
	).Scan(&roleID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "role not found in database"})
	}

	res, err := h.db.Exec(context.Background(),
		`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`, roleID, id,
	)
	if err != nil || res.RowsAffected() == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	return c.JSON(fiber.Map{"message": "role updated to " + body.Role})
}

// PUT /admin/users/:id/status   body: {"is_active": true|false}
func (h *Handler) AdminUpdateStatus(c *fiber.Ctx) error {
	requester := c.Locals("user").(*models.User)
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid user id"})
	}
	if requester.ID == id {
		return c.Status(400).JSON(fiber.Map{"error": "cannot change your own active status"})
	}

	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
	}

	res, err := h.db.Exec(context.Background(),
		`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`, body.IsActive, id,
	)
	if err != nil || res.RowsAffected() == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}

	// If deactivating — immediately revoke all sessions
	if !body.IsActive {
		h.db.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, id)
	}

	status := "activated"
	if !body.IsActive {
		status = "deactivated"
	}
	return c.JSON(fiber.Map{"message": "user " + status})
}

// DELETE /admin/users/:id
func (h *Handler) AdminDeleteUser(c *fiber.Ctx) error {
	requester := c.Locals("user").(*models.User)
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid user id"})
	}
	if requester.ID == id {
		return c.Status(400).JSON(fiber.Map{"error": "cannot delete your own account via admin panel"})
	}

	res, err := h.db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	if err != nil || res.RowsAffected() == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "user not found"})
	}
	return c.JSON(fiber.Map{"message": "user deleted"})
}

// GET /admin/roles — list all roles with their permissions
func (h *Handler) AdminListRoles(c *fiber.Ctx) error {
	rows, err := h.db.Query(context.Background(), `
		SELECT r.id, r.name, r.description,
		       COALESCE(array_agg(p.name ORDER BY p.name) FILTER (WHERE p.name IS NOT NULL), ARRAY[]::text[])
		FROM roles r
		LEFT JOIN role_permissions rp ON rp.role_id = r.id
		LEFT JOIN permissions p ON p.id = rp.permission_id
		GROUP BY r.id, r.name, r.description
		ORDER BY r.id
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	type RoleRow struct {
		ID          int      `json:"id"`
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}
	var result []RoleRow
	for rows.Next() {
		var r RoleRow
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.Permissions); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "scan error"})
		}
		result = append(result, r)
	}
	if result == nil {
		result = []RoleRow{}
	}
	return c.JSON(result)
}

// GET /admin/permissions — list all available permissions
func (h *Handler) AdminListPermissions(c *fiber.Ctx) error {
	rows, err := h.db.Query(context.Background(),
		`SELECT id, name, description FROM permissions ORDER BY name`,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	type PermRow struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	var result []PermRow
	for rows.Next() {
		var p PermRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Description); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "scan error"})
		}
		result = append(result, p)
	}
	if result == nil {
		result = []PermRow{}
	}
	return c.JSON(result)
}

// GET /admin/sessions — view all active sessions (for security audit)
func (h *Handler) AdminListSessions(c *fiber.Ctx) error {
	rows, err := h.db.Query(context.Background(), `
		SELECT s.id, s.user_id, u.email, u.username, r.name,
		       s.created_at, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN roles  r ON r.id = u.role_id
		WHERE s.expires_at > NOW()
		ORDER BY s.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	defer rows.Close()

	type SessionRow struct {
		ID        string `json:"id"`
		UserID    int    `json:"user_id"`
		Email     string `json:"email"`
		Username  string `json:"username"`
		Role      string `json:"role"`
		CreatedAt string `json:"created_at"`
		ExpiresAt string `json:"expires_at"`
	}
	var result []SessionRow
	for rows.Next() {
		var s SessionRow
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.Email, &s.Username, &s.Role,
			&s.CreatedAt, &s.ExpiresAt,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "scan error"})
		}
		// Mask session ID for security — show only first 8 chars
		if len(s.ID) > 8 {
			s.ID = s.ID[:8] + "..."
		}
		result = append(result, s)
	}
	if result == nil {
		result = []SessionRow{}
	}
	return c.JSON(result)
}

// DELETE /admin/sessions/:user_id — revoke all sessions for a user
func (h *Handler) AdminRevokeUserSessions(c *fiber.Ctx) error {
	id, err := strconv.Atoi(c.Params("user_id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid user id"})
	}
	res, err := h.db.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "database error"})
	}
	return c.JSON(fiber.Map{"message": "sessions revoked", "count": res.RowsAffected()})
}
