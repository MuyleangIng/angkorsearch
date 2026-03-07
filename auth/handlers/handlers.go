package handlers

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	githubOAuth "golang.org/x/oauth2/github"

	"angkorsearch/auth/config"
	"angkorsearch/auth/db"
	"angkorsearch/auth/mail"
)

// Handler holds shared dependencies for all route handlers.
type Handler struct {
	cfg    *config.Config
	db     *pgxpool.Pool
	perms  *db.PermissionStore
	mailer *mail.Mailer
	google *oauth2.Config
	github *oauth2.Config
}

func New(cfg *config.Config, pool *pgxpool.Pool, perms *db.PermissionStore, mailer *mail.Mailer) *Handler {
	return &Handler{
		cfg:    cfg,
		db:     pool,
		perms:  perms,
		mailer: mailer,
		google: &oauth2.Config{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
			RedirectURL:  cfg.GoogleRedirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     google.Endpoint,
		},
		github: &oauth2.Config{
			ClientID:     cfg.GitHubClientID,
			ClientSecret: cfg.GitHubClientSecret,
			RedirectURL:  cfg.GitHubRedirectURL,
			Scopes:       []string{"user:email"},
			Endpoint:     githubOAuth.Endpoint,
		},
	}
}
