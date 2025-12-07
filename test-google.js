// Save as: check-permissions.js
// Run with: node check-permissions.js

require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function deepDiagnostic() {
  console.log('=== DEEP PERMISSION DIAGNOSTIC ===\n');

  try {
    // Load credentials
    const credentialsPath = path.resolve('./config/google-credentials.json');
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    console.log('Service Account:', credentials.client_email);
    console.log('Project ID:', credentials.project_id);
    console.log('');

    // Check 1: Verify the private key format
    console.log('🔍 CHECK 1: Private Key Format');
    console.log('─'.repeat(50));
    const privateKey = credentials.private_key;
    console.log('Length:', privateKey.length);
    console.log('Has BEGIN:', privateKey.includes('-----BEGIN PRIVATE KEY-----'));
    console.log('Has END:', privateKey.includes('-----END PRIVATE KEY-----'));
    console.log('Newlines preserved:', privateKey.includes('\\n'));
    
    // Check if newlines are properly formatted
    if (privateKey.includes('\\n')) {
      console.log('⚠️  WARNING: Private key has escaped newlines (\\n as text)');
      console.log('   This might cause authentication issues.');
      console.log('   The key should have actual newline characters, not \\n text.');
    } else {
      console.log('✓ Private key format looks good');
    }
    console.log('');

    // Check 2: Create auth with explicit scopes
    console.log('🔐 CHECK 2: Testing Different Scope Combinations');
    console.log('─'.repeat(50));

    // Test 1: Minimal scopes
    console.log('\nTest A: Minimal Scopes (spreadsheets only)');
    try {
      const auth1 = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const client1 = await auth1.getClient();
      const sheets1 = google.sheets({ version: 'v4', auth: client1 });
      
      const result1 = await sheets1.spreadsheets.create({
        requestBody: {
          properties: { title: 'Test Minimal Scopes' }
        }
      });
      
      console.log('✓ SUCCESS with minimal scopes!');
      console.log('  Spreadsheet ID:', result1.data.spreadsheetId);
      
      // Cleanup
      const drive1 = google.drive({ version: 'v3', auth: client1 });
      await drive1.files.delete({ fileId: result1.data.spreadsheetId });
      console.log('✓ Cleaned up');
      
    } catch (err1) {
      console.log('❌ FAILED with minimal scopes');
      console.log('   Error:', err1.message);
      console.log('   Code:', err1.code);
    }

    // Test 2: All scopes
    console.log('\nTest B: All Scopes (spreadsheets + drive.file + drive)');
    try {
      const auth2 = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive'
        ]
      });
      const client2 = await auth2.getClient();
      const sheets2 = google.sheets({ version: 'v4', auth: client2 });
      
      const result2 = await sheets2.spreadsheets.create({
        requestBody: {
          properties: { title: 'Test All Scopes' }
        }
      });
      
      console.log('✓ SUCCESS with all scopes!');
      console.log('  Spreadsheet ID:', result2.data.spreadsheetId);
      
      // Cleanup
      const drive2 = google.drive({ version: 'v3', auth: client2 });
      await drive2.files.delete({ fileId: result2.data.spreadsheetId });
      console.log('✓ Cleaned up');
      
    } catch (err2) {
      console.log('❌ FAILED with all scopes');
      console.log('   Error:', err2.message);
      console.log('   Code:', err2.code);
    }

    // Check 3: Test with JWT directly
    console.log('\n🔐 CHECK 3: Testing JWT Authentication Directly');
    console.log('─'.repeat(50));
    
    const { JWT } = require('google-auth-library');
    const jwtClient = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    try {
      await jwtClient.authorize();
      console.log('✓ JWT authorization successful');
      console.log('  Access token obtained:', !!jwtClient.credentials.access_token);
      
      const sheets3 = google.sheets({ version: 'v4', auth: jwtClient });
      const result3 = await sheets3.spreadsheets.create({
        requestBody: {
          properties: { title: 'Test JWT Direct' }
        }
      });
      
      console.log('✓ SUCCESS with JWT direct!');
      console.log('  Spreadsheet ID:', result3.data.spreadsheetId);
      
      // Cleanup
      const drive3 = google.drive({ version: 'v3', auth: jwtClient });
      await drive3.files.delete({ fileId: result3.data.spreadsheetId });
      console.log('✓ Cleaned up');
      
    } catch (err3) {
      console.log('❌ FAILED with JWT direct');
      console.log('   Error:', err3.message);
      console.log('   Code:', err3.code);
      
      if (err3.message.includes('invalid_grant')) {
        console.log('\n⚠️  CRITICAL: Invalid grant error!');
        console.log('   This usually means:');
        console.log('   1. The private key is malformed');
        console.log('   2. The service account was deleted and recreated');
        console.log('   3. System clock is wrong');
        console.log('   4. The key file is corrupted');
        console.log('\n   Solution: Download a NEW key for your service account');
      }
    }

    // Check 4: Verify API is actually enabled
    console.log('\n📊 CHECK 4: Verify API Status via Test Request');
    console.log('─'.repeat(50));
    
    const testAuth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const testClient = await testAuth.getClient();
    
    // Try to list spreadsheets (this should work even without creating)
    try {
      const drive = google.drive({ version: 'v3', auth: testClient });
      const fileList = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet'",
        pageSize: 1,
        fields: 'files(id, name)'
      });
      
      console.log('✓ Can list files in Drive');
      console.log('  Found spreadsheets:', fileList.data.files?.length || 0);
      
    } catch (err4) {
      console.log('❌ Cannot list files');
      console.log('   Error:', err4.message);
    }

    console.log('\n');
    console.log('=== DIAGNOSTIC COMPLETE ===');
    console.log('\nIf all tests failed with 403:');
    console.log('1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts?project=' + credentials.project_id);
    console.log('2. Click on your service account');
    console.log('3. Go to "KEYS" tab');
    console.log('4. Click "ADD KEY" → "Create new key" → "JSON"');
    console.log('5. Replace your credentials file with the new one');
    console.log('6. Make sure to ENABLE the APIs again if you created a new project');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    console.error(error.stack);
  }
}

deepDiagnostic();