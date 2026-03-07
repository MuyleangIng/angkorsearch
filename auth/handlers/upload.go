package handlers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"

	"angkorsearch/auth/models"
)

const maxAvatarSize = 5 * 1024 * 1024 // 5 MB

var allowedMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// POST /auth/avatar   multipart/form-data field: "avatar"
func (h *Handler) UploadAvatar(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)

	file, err := c.FormFile("avatar")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "avatar file required (field name: avatar)"})
	}

	if file.Size > maxAvatarSize {
		return c.Status(400).JSON(fiber.Map{"error": "file too large — maximum size is 5 MB"})
	}

	contentType := file.Header.Get("Content-Type")
	ext, ok := allowedMIME[contentType]
	if !ok {
		return c.Status(400).JSON(fiber.Map{"error": "unsupported file type — use JPEG, PNG, WebP, or GIF"})
	}

	// Create avatars directory if it doesn't exist
	dir := "/app/data/avatars"
	if err := os.MkdirAll(dir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "storage error"})
	}

	filename := fmt.Sprintf("%d%s", user.ID, ext)
	savePath := filepath.Join(dir, filename)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to save file"})
	}

	avatarURL := "/avatars/" + filename
	_, err = h.db.Exec(context.Background(),
		`UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2`,
		avatarURL, user.ID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to update avatar URL"})
	}

	return c.JSON(fiber.Map{
		"avatar_url": avatarURL,
		"message":    "avatar updated successfully",
	})
}

// DELETE /auth/avatar — remove avatar, revert to empty
func (h *Handler) DeleteAvatar(c *fiber.Ctx) error {
	user := c.Locals("user").(*models.User)

	// Remove file from disk (ignore errors — file may not exist)
	for _, ext := range []string{".jpg", ".png", ".webp", ".gif"} {
		os.Remove(filepath.Join("/app/data/avatars", fmt.Sprintf("%d%s", user.ID, ext)))
	}

	h.db.Exec(context.Background(),
		`UPDATE users SET avatar_url = '', updated_at = NOW() WHERE id = $1`, user.ID,
	)
	return c.JSON(fiber.Map{"message": "avatar removed"})
}
