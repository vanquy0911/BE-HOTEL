// Test script for forgot-password API
import fetch from 'node-fetch';

const testForgotPassword = async () => {
  try {
    console.log('🧪 Testing forgot-password API...');
    
    const response = await fetch('http://localhost:5000/api/users/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'khangnguyen3k@gmail.com'
      })
    });

    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Headers:', Object.fromEntries(response.headers.entries()));
    
    const data = await response.json();
    console.log('📊 Response Data:', data);

    if (response.ok) {
      console.log('✅ Test PASSED - API working correctly');
    } else {
      console.log('❌ Test FAILED - API returned error');
    }
  } catch (error) {
    console.error('❌ Test ERROR:', error.message);
  }
};

// Run test
testForgotPassword();

