import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('encrypted PHP profiles reject tampering and expose only individual allowed fields', () => {
  execFileSync('php', ['server-php/tests/profile-security.php'], { stdio: 'pipe' });
});
