
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { pool } from "../db.js";

export interface AuthUser {
  id: string;
  google_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(new Error("Google account has no email address"));
        }

        const result = await pool.query<AuthUser>(
          `INSERT INTO oauth_users (
             google_id, email, name, avatar_url
           )
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (google_id)
           DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url,
             updated_at = NOW()
           RETURNING id, google_id, email, name, avatar_url`,
          [
            profile.id,
            email,
            profile.displayName || null,
            profile.photos?.[0]?.value ?? null,
          ]
        );

        return done(null, result.rows[0]);
      } catch (error) {
        return done(
          error instanceof Error ? error : new Error("Google login failed")
        );
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query<AuthUser>(
      `SELECT id, google_id, email, name, avatar_url
       FROM oauth_users
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return done(null, false);
    }

    return done(null, result.rows[0]);
  } catch (error) {
    return done(
      error instanceof Error ? error : new Error("Session lookup failed")
    );
  }
});

export default passport;
