import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";

// Google Strategy - chỉ khởi tạo nếu có credentials
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Pass profile to callback
          return done(null, profile);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
  console.log('✅ Google OAuth strategy initialized');
} else {
  console.log('⚠️  Google OAuth credentials not found. Google login will not work.');
}

// Facebook Strategy - chỉ khởi tạo nếu có credentials
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    "facebook",
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/facebook/callback`,
        profileFields: ['id', 'displayName', 'emails', 'photos']
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Pass profile to callback
          return done(null, profile);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
  console.log('✅ Facebook OAuth strategy initialized');
} else {
  console.log('⚠️  Facebook OAuth credentials not found. Facebook login will not work.');
}

// Serialize user (not needed for OAuth but required by passport)
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

export default passport;

