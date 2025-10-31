import fetch from 'node-fetch';

const testAPI = async () => {
  try {
    console.log('🔍 Testing API endpoints...\n');

    // Test 1: Check if server is running
    console.log('1. Testing server connection...');
    const response = await fetch('http://localhost:5000/api/payments');
    console.log('   Status:', response.status);
    console.log('   OK:', response.ok);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('   Error:', errorText);
    } else {
      const data = await response.json();
      console.log('   Response:', data);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
};

testAPI();

