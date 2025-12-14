#!/usr/bin/env node

/**
 * Migration script to switch from current system to optimized session management
 * 
 * This script will:
 * 1. Backup current index.ts
 * 2. Replace with optimized version
 * 3. Update package.json if needed
 * 4. Provide instructions for frontend updates
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 Migrating to Optimized Session Management System...\n');

// Step 1: Backup current index.ts
console.log('📦 Step 1: Backing up current system...');
try {
  if (fs.existsSync('src/index.ts')) {
    fs.copyFileSync('src/index.ts', 'src/index.backup.ts');
    console.log('✅ Current index.ts backed up to index.backup.ts');
  }
} catch (error) {
  console.error('❌ Error backing up current system:', error.message);
  process.exit(1);
}

// Step 2: Replace with optimized version
console.log('\n🔧 Step 2: Installing optimized system...');
try {
  if (fs.existsSync('src/index.optimized.ts')) {
    fs.copyFileSync('src/index.optimized.ts', 'src/index.ts');
    console.log('✅ Optimized system installed as index.ts');
  } else {
    console.error('❌ index.optimized.ts not found. Please ensure all files are created.');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error installing optimized system:', error.message);
  process.exit(1);
}

// Step 3: Check package.json
console.log('\n📋 Step 3: Checking package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  // Check if required dependencies exist
  const requiredDeps = ['socket.io', 'express', 'mongoose', 'cors', 'dotenv'];
  const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies[dep]);
  
  if (missingDeps.length > 0) {
    console.log('⚠️  Missing dependencies:', missingDeps.join(', '));
    console.log('   Run: npm install ' + missingDeps.join(' '));
  } else {
    console.log('✅ All required dependencies found');
  }
  
  // Check scripts
  if (!packageJson.scripts.dev) {
    console.log('⚠️  Consider adding dev script: "dev": "tsx watch src/index.ts"');
  }
  
} catch (error) {
  console.error('❌ Error checking package.json:', error.message);
}

// Step 4: Create environment template
console.log('\n🌍 Step 4: Environment configuration...');
try {
  const envTemplate = `# Drawzzl Backend Environment Configuration
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/drawzzl

# Optional: Enable garbage collection logging
# NODE_OPTIONS="--expose-gc"
`;

  if (!fs.existsSync('.env')) {
    fs.writeFileSync('.env', envTemplate);
    console.log('✅ Created .env template');
  } else {
    console.log('✅ .env file already exists');
  }
} catch (error) {
  console.error('❌ Error creating .env template:', error.message);
}

// Step 5: Provide instructions
console.log('\n📝 Migration Complete! Next Steps:\n');

console.log('🔧 Backend Setup:');
console.log('   1. Install dependencies: npm install');
console.log('   2. Update .env file with your MongoDB URI');
console.log('   3. Build the project: npm run build');
console.log('   4. Start the server: npm start');

console.log('\n🎨 Frontend Updates Required:');
console.log('   1. Add session storage in localStorage');
console.log('   2. Implement reconnection logic');
console.log('   3. Update quit handler with acknowledgment');
console.log('   4. See OPTIMIZED_SESSION_MANAGEMENT.md for details');

console.log('\n🧪 Testing:');
console.log('   1. Test normal game flow');
console.log('   2. Test page reload (should reconnect)');
console.log('   3. Test quit button (should remove immediately)');
console.log('   4. Test AFK detection (wait 2+ minutes inactive)');

console.log('\n📊 Monitoring:');
console.log('   • Health check: GET /health');
console.log('   • Statistics: GET /stats');
console.log('   • Check server logs for detailed information');

console.log('\n🔄 Rollback (if needed):');
console.log('   • Restore: cp src/index.backup.ts src/index.ts');
console.log('   • Rebuild and restart');

console.log('\n✨ New Features Available:');
console.log('   ✅ Session management with reconnection');
console.log('   ✅ AFK detection and removal');
console.log('   ✅ Comprehensive error recovery');
console.log('   ✅ Clean resource management');
console.log('   ✅ Production monitoring');
console.log('   ✅ Modular architecture');

console.log('\n🎉 Migration completed successfully!');
console.log('📖 Read OPTIMIZED_SESSION_MANAGEMENT.md for full documentation.');