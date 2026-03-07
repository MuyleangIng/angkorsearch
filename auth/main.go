package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"angkorsearch/auth/config"
	authdb "angkorsearch/auth/db"
	"angkorsearch/auth/handlers"
	"angkorsearch/auth/mail"
	"angkorsearch/auth/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := authdb.Connect(cfg)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()

	// Load RBAC permissions from DB into in-memory cache
	perms := authdb.NewPermissionStore()
	if err := perms.Load(pool); err != nil {
		log.Fatalf("Failed to load RBAC permissions: %v", err)
	}
	log.Println("RBAC permissions loaded from database")

	mailer := mail.New(cfg)

	app := fiber.New(fiber.Config{
		AppName: "AngkorSearch Auth v1.0",
	})

	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.FrontendURL,
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept",
		AllowMethods:     "GET, POST, PUT, DELETE",
	}))

	h    := handlers.New(cfg, pool, perms, mailer)
	auth := middleware.RequireAuth(pool, perms)
	adminOnly := middleware.RequireRole("admin")

	// ── Public endpoints ──────────────────────────────────────────────────────
	r := app.Group("/auth")
	r.Post("/register",       h.Register)
	r.Post("/login",          h.Login)
	r.Get("/google",          h.GoogleLogin)
	r.Get("/google/callback", h.GoogleCallback)
	r.Get("/github",          h.GitHubLogin)
	r.Get("/github/callback", h.GitHubCallback)
	// Email verification (link from email — GET redirects to frontend)
	r.Get("/verify-email",    h.VerifyEmailLink)
	// Password reset (public)
	r.Post("/forgot-password", h.ForgotPassword)
	r.Post("/reset-password",  h.ResetPassword)

	// ── Authenticated endpoints (any role) ────────────────────────────────────
	r.Get("/me",          auth, h.Me)
	r.Post("/logout",     auth, h.Logout)
	r.Post("/logout-all", auth, h.LogoutAllDevices)
	r.Put("/profile",     auth, middleware.RequirePermission("profile:update"), h.UpdateProfile)
	r.Put("/password",    auth, h.ChangePassword)
	r.Delete("/account",  auth, middleware.RequirePermission("account:delete"), h.DeleteAccount)
	// Email verification (POST — JSON for SPA; resend)
	r.Post("/verify-email",        auth, h.VerifyEmail)
	r.Post("/resend-verification", auth, h.ResendVerification)
	// Avatar upload
	r.Post("/avatar",   auth, h.UploadAvatar)
	r.Delete("/avatar", auth, h.DeleteAvatar)

	// ── Admin endpoints (admin role only) ─────────────────────────────────────
	admin := app.Group("/admin", auth, adminOnly)
	admin.Get("/users",                   h.AdminListUsers)
	admin.Get("/users/:id",               h.AdminGetUser)
	admin.Put("/users/:id/role",          h.AdminUpdateRole)
	admin.Put("/users/:id/status",        h.AdminUpdateStatus)
	admin.Delete("/users/:id",            h.AdminDeleteUser)
	admin.Get("/roles",                   h.AdminListRoles)
	admin.Get("/permissions",             h.AdminListPermissions)
	admin.Get("/sessions",                h.AdminListSessions)
	admin.Delete("/sessions/:user_id",    h.AdminRevokeUserSessions)

	// ── Health ────────────────────────────────────────────────────────────────
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "service": "auth"})
	})

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("Shutting down auth service...")
		_ = app.Shutdown()
	}()

	log.Printf("Auth service starting on :%s", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
