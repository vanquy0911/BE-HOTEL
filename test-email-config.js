// Test email configuration
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

console.log('🔍 Testing Email Configuration...');
console.log('=====================================');

// Check environment variables
console.log('📋 Environment Variables:');
console.log('  EMAIL_USER:', process.env.EMAIL_USER || 'NOT SET');
console.log('  EMAIL_PASS:', process.env.EMAIL_PASS ? '***' : 'NOT SET');
console.log('  NODE_ENV:', process.env.NODE_ENV || 'NOT SET');

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.log('❌ Email configuration is incomplete!');
  console.log('Please update .env file with correct EMAIL_USER and EMAIL_PASS');
  process.exit(1);
}

// Test nodemailer configuration
console.log('\n📧 Testing Nodemailer Configuration...');
try {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  console.log('✅ Transporter created successfully');
  
  // Test connection
  transporter.verify((error, success) => {
    if (error) {
      console.log('❌ Email connection failed:', error.message);
      console.log('💡 Common issues:');
      console.log('  - Wrong App Password');
      console.log('  - 2FA not enabled');
      console.log('  - Less secure app access disabled');
    } else {
      console.log('✅ Email connection successful!');
      console.log('📧 Ready to send emails');
    }
  });

} catch (error) {
  console.log('❌ Error creating transporter:', error.message);
}

