
import { Router } from "express";
import passport from "../auth/passport.js";

const router = Router();

const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:3000";

router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${frontendUrl}/?authError=google_login_failed`,
  }),
  (_req, res) => {
    res.redirect(frontendUrl);
  }
);

router.get("/me", (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({
      authenticated: false,
      user: null,
    });
  }

  const { id, email, name, avatar_url } = req.user;

  return res.json({
    authenticated: true,
    user: { id, email, name, avatar_url },
  });
});

router.post("/logout", (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) return next(logoutError);

    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);

      res.clearCookie("reachinbox.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });

      return res.json({ message: "Logged out successfully" });
    });
  });
});

export default router;
