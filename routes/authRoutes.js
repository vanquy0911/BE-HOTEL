import express from "express";
import passport from "../config/passport.js";
import { googleCallback, facebookCallback } from "../Controller/oauthController.js";

const router = express.Router();

// Middleware để check OAuth credentials
const checkGoogleCredentials = (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Google OAuth credentials not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env file."
    });
  }
  next();
};

const checkFacebookCredentials = (req, res, next) => {
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Facebook OAuth credentials not configured. Please add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to .env file."
    });
  }
  next();
};

// Google OAuth Routes
router.get(
  "/google",
  checkGoogleCredentials,
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

router.get(
  "/google/callback",
  checkGoogleCredentials,
  passport.authenticate("google", {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`,
    session: false, // Không dùng session, dùng JWT
  }),
  googleCallback
);

// Facebook OAuth Routes
router.get(
  "/facebook",
  checkFacebookCredentials,
  passport.authenticate("facebook", {
    scope: ["email", "public_profile"],
  })
);

router.get(
  "/facebook/callback",
  checkFacebookCredentials,
  passport.authenticate("facebook", {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=oauth_failed`,
    session: false, // Không dùng session, dùng JWT
  }),
  facebookCallback
);

export default router;

