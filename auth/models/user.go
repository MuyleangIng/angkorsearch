package models

import "time"

// User is returned to authenticated clients and stored in request context.
type User struct {
	ID            int       `json:"id"`
	Email         string    `json:"email"`
	Username      string    `json:"username"`
	AvatarURL     string    `json:"avatar_url"`
	Bio           string    `json:"bio"`
	Website       string    `json:"website"`
	Location      string    `json:"location"`
	Role          string    `json:"role"`
	IsActive      bool      `json:"is_active"`
	EmailVerified bool      `json:"email_verified"`
	HasGoogle     bool      `json:"has_google"`
	HasGitHub     bool      `json:"has_github"`
	CreatedAt     time.Time `json:"created_at"`
	Permissions   []string  `json:"-"` // internal use only, never sent to client
}

// HasPermission checks if the user has a specific permission.
func (u *User) HasPermission(p string) bool {
	for _, perm := range u.Permissions {
		if perm == p {
			return true
		}
	}
	return false
}

// UserListItem is used by admin endpoints — includes last_login.
type UserListItem struct {
	ID        int        `json:"id"`
	Email     string     `json:"email"`
	Username  string     `json:"username"`
	AvatarURL string     `json:"avatar_url"`
	Role      string     `json:"role"`
	IsActive  bool       `json:"is_active"`
	HasGoogle bool       `json:"has_google"`
	HasGitHub bool       `json:"has_github"`
	CreatedAt time.Time  `json:"created_at"`
	LastLogin *time.Time `json:"last_login"`
}
