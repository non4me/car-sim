// Verify Phase 1 accounts on PRODUCTION: register (email) → /me → /admin (Vlad-admin email) →
// user management. Drives the real https endpoints with a cookie jar via fetch in Node.
// Usage: node tools/verify_accounts.mjs  (uses a throwaway email each run via the arg timestamp)
const BASE = process.env.BASE || 'https://car-sim.troyanenko.com';
const STAMP = process.argv[2] || String(Math.floor(Date.now() / 1000));

// minimal cookie jar over fetch
function jar() {
  const cookies = {};
  const hdr = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const take = (res) => {
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const [kv] = c.split(';'); const i = kv.indexOf('='); cookies[kv.slice(0, i)] = kv.slice(i + 1); }
  };
  return { hdr, take };
}

async function main() {
  const j = jar();
  const out = {};
  const go = async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      ...opts, redirect: 'manual',
      headers: { ...(opts.headers || {}), cookie: j.hdr() },
    });
    j.take(res);
    return res;
  };
  const form = (o) => new URLSearchParams(o).toString();
  const FORMH = { 'content-type': 'application/x-www-form-urlencoded' };

  // anonymous /me → must redirect to /login
  out.anonMe = (await go('/me')).status;                       // expect 303
  // login page renders + reflects Google availability
  const lp = await go('/login'); out.loginPage = lp.status;
  const lpBody = await lp.text();
  out.googleButton = /auth\/google/.test(lpBody);
  out.hasEmailForm = /name="password"/.test(lpBody);

  // register a fresh email user
  const email = `verify+${STAMP}@example.com`;
  const reg = await go('/auth/register', { method: 'POST', headers: FORMH,
    body: form({ email, password: 'verify-pass-123', display_name: 'Verify Bot' }) });
  out.register = reg.status;                                    // expect 303 → /me
  out.regLocation = reg.headers.get('location');

  // now /me works (200) and shows the email
  const meRes = await go('/me'); out.meAfter = meRes.status;
  const meBody = await meRes.text();
  out.meShowsEmail = meBody.includes(email);
  out.meHasExport = /\/me\/export/.test(meBody);
  out.meHasDelete = /\/me\/delete/.test(meBody);

  // a normal user must NOT reach /admin
  out.userAdmin = (await go('/admin')).status;                 // expect 403

  // GDPR export returns JSON for this user
  const ex = await go('/me/export'); out.exportStatus = ex.status;
  try { const d = await ex.json(); out.exportEmail = d.user && d.user.email; } catch { out.exportEmail = null; }

  // logout, then a duplicate-register must 409
  out.logout = (await go('/auth/logout')).status;              // 303
  const dup = await go('/auth/register', { method: 'POST', headers: FORMH,
    body: form({ email, password: 'verify-pass-123' }) });
  out.dupRegister = dup.status;                                // expect 409

  // wrong password login → 401
  const bad = await go('/auth/login', { method: 'POST', headers: FORMH,
    body: form({ email, password: 'WRONG' }) });
  out.badLogin = bad.status;                                   // 401

  // SECURITY: registering the admin email via email/password must NOT grant admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const squatEmail = adminEmail;                              // try to squat the admin address
    const squat = await go('/auth/register', { method: 'POST', headers: FORMH,
      body: form({ email: squatEmail, password: 'squatter-12345' }) });
    // either already exists (409, seeded) or created as plain user (303) — never admin
    out.squatStatus = squat.status;
    if (squat.status === 303) {
      const squatAdmin = await go('/admin');                   // must be 403 (not elevated)
      out.squatGotAdmin = squatAdmin.status === 200;           // expect false
      await go('/me/delete', { method: 'POST' });              // clean up the squat account
    } else {
      out.squatGotAdmin = false;
    }
  }

  // ADMIN flow — log in as the seeded admin (email+password from env), manage users
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPw) {
    const aj = jar();
    const ago = async (path, opts = {}) => {
      const res = await fetch(BASE + path, { ...opts, redirect: 'manual',
        headers: { ...(opts.headers || {}), cookie: aj.hdr() } });
      aj.take(res); return res;
    };
    const alogin = await ago('/auth/login', { method: 'POST', headers: FORMH,
      body: form({ email: adminEmail, password: adminPw }) });
    out.adminLogin = alogin.status;                            // 303
    const adminPage = await ago('/admin'); out.adminPage = adminPage.status;   // 200
    const adminBody = await adminPage.text();
    out.adminSeesTestUser = adminBody.includes(email);
    // find the test user's id and delete it via the admin panel (proves user mgmt + cleans up)
    const m = adminBody.match(new RegExp('/admin/users/(\\d+)/delete"[^]*?' + email.replace(/[.+]/g, '\\$&')))
      || adminBody.match(/\/admin\/users\/(\d+)\/delete/);
    // robust: parse the row for our email → its id
    let testId = null;
    const rowRe = /\/admin\/users\/(\d+)\/role/g; let mm;
    // fallback: query export not available; instead re-fetch /admin and scan rows containing email
    const idMatch = adminBody.split('<tr>').find((r) => r.includes(email));
    if (idMatch) { const im = idMatch.match(/\/admin\/users\/(\d+)\//); if (im) testId = im[1]; }
    if (testId) {
      const del = await ago(`/admin/users/${testId}/delete`, { method: 'POST', headers: FORMH, body: '' });
      out.adminDelete = del.status;                            // 303
      const after = await ago('/admin'); const ab = await after.text();
      out.testUserGone = !ab.includes(email);
    }
  }

  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
