import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type SignupRequest = {
  owner_name?: unknown;
  cafe_name?: unknown;
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: SignupRequest;
  try {
    body = await request.json() as SignupRequest;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const ownerName = typeof body.owner_name === 'string' ? body.owner_name.trim() : '';
  const cafeName = typeof body.cafe_name === 'string' ? body.cafe_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!ownerName || !cafeName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
    return NextResponse.json(
      { error: 'Owner name, cafe name, a valid email address, and a password of at least 6 characters are required.' },
      { status: 400 }
    );
  }

  let adminClient;
  try {
    adminClient = createSupabaseAdminClient();
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Supabase admin client is unavailable.',
    }, { status: 500 });
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { owner_name: ownerName, cafe_name: cafeName },
  });
  if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });
  if (!created.user) {
    return NextResponse.json({ error: 'Supabase did not return the new user account.' }, { status: 502 });
  }

  const userId = created.user.id;
  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: userId,
    email: created.user.email ?? email,
    owner_name: ownerName,
    cafe_name: cafeName,
    role: 'admin',
    franchise_owner_id: userId,
  }, { onConflict: 'id' });

  if (profileError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
    const cleanupMessage = cleanupError ? ` Account cleanup failed: ${cleanupError.message}` : '';
    return NextResponse.json({ error: `Could not create cafe owner profile: ${profileError.message}${cleanupMessage}` }, { status: 500 });
  }

  const { error: employeeError } = await adminClient.from('employees').insert({
    owner_id: userId,
    franchise_owner_id: userId,
    auth_user_id: userId,
    user_id: userId,
    email: created.user.email ?? email,
    full_name: ownerName,
    role: 'Admin',
    hourly_rate: 0,
    employment_type: 'full_time',
    hours_worked: 0,
    salary_paid: false,
  });

  if (employeeError) {
    const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
    const cleanupMessage = cleanupError ? ` Account cleanup failed: ${cleanupError.message}` : '';
    return NextResponse.json({ error: `Could not create owner employee record: ${employeeError.message}${cleanupMessage}` }, { status: 500 });
  }

  return NextResponse.json({ email: created.user.email ?? email }, { status: 201 });
}
