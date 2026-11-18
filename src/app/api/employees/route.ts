import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type EmployeeRole = 'Admin' | 'Barista';

type EmployeeRequest = {
  full_name?: unknown;
  role?: unknown;
  email?: unknown;
  password?: unknown;
  hourly_rate?: unknown;
  employment_type?: unknown;
  hours_worked?: unknown;
  salary_paid?: unknown;
  phone?: unknown;
  hired_date?: unknown;
  employee_id?: unknown;
};

async function getAdminRequestContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) return { response: NextResponse.json({ error: authError.message }, { status: 401 }) };
  if (!user) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, franchise_owner_id, cafe_name')
    .eq('id', user.id)
    .single();
  if (profileError) return { response: NextResponse.json({ error: profileError.message }, { status: 403 }) };
  if (profile.role !== 'admin') {
    return { response: NextResponse.json({ error: 'Only franchise admins can manage team members.' }, { status: 403 }) };
  }
  if (!profile.franchise_owner_id) {
    return { response: NextResponse.json({ error: 'No active branch is assigned to this account.' }, { status: 403 }) };
  }
  const { data: branch, error: branchError } = await supabase
    .from('franchise_branches')
    .select('owner_user_id')
    .eq('id', profile.franchise_owner_id)
    .single();
  if (branchError) return { response: NextResponse.json({ error: branchError.message }, { status: 403 }) };
  return { supabase, user, profile, isHQOwner: branch.owner_user_id === user.id };
}

export async function POST(request: Request) {
  let body: EmployeeRequest;
  try {
    body = await request.json() as EmployeeRequest;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role;
  const hourlyRate = Number(body.hourly_rate ?? 0);
  const employmentType = body.employment_type;
  const hoursWorked = Number(body.hours_worked ?? 0);
  const salaryPaid = body.salary_paid === true;
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const hiredDate = typeof body.hired_date === 'string' && body.hired_date ? body.hired_date : null;
  if (!fullName || !email || password.length < 6 || (role !== 'Barista' && role !== 'Admin')) {
    return NextResponse.json(
      { error: 'Full name, email, a password of at least 6 characters, and a valid role are required.' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    return NextResponse.json({ error: 'Hourly rate must be zero or greater.' }, { status: 400 });
  }
  if (
    (employmentType !== 'full_time' && employmentType !== 'part_time')
    || !Number.isFinite(hoursWorked)
    || hoursWorked < 0
    || !Number.isInteger(hoursWorked * 2)
  ) {
    return NextResponse.json({ error: 'Choose a valid work type and non-negative hours worked.' }, { status: 400 });
  }

  const context = await getAdminRequestContext();
  if ('response' in context) return context.response;
  if (!context.isHQOwner) {
    return NextResponse.json({ error: 'Only the HQ Owner can create new employee accounts.' }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const nonce = randomUUID();
  const userMetadata = {
    owner_name: fullName,
    cafe_name: context.profile.cafe_name,
    franchise_provisioning_nonce: nonce,
  };
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const provisioningClient = serviceRoleKey
    ? createSupabaseAdminClient()
    : createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });

  const createUserResult = serviceRoleKey
    ? await provisioningClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      })
    : await provisioningClient.auth.signUp({
        email,
        password,
        options: { data: userMetadata },
      });
  if (createUserResult.error) {
    return NextResponse.json({ error: createUserResult.error.message }, { status: 400 });
  }
  const newUser = createUserResult.data.user;
  if (!newUser) {
    return NextResponse.json({ error: 'Supabase did not return the new user account.' }, { status: 502 });
  }

  const { data: employeeId, error: createEmployeeError } = await context.supabase.rpc('create_franchise_employee', {
    p_user_id: newUser.id,
    p_email: newUser.email ?? email,
    p_full_name: fullName,
    p_role: role as EmployeeRole,
    p_hourly_rate: hourlyRate,
    p_phone: phone,
    p_hired_date: hiredDate,
    p_provisioning_nonce: nonce,
    p_employment_type: employmentType,
    p_hours_worked: employmentType === 'part_time' ? hoursWorked : 0,
    p_salary_paid: salaryPaid,
  });
  if (createEmployeeError || !employeeId) {
    let cleanupMessage = '';
    if (serviceRoleKey) {
      const { error: cleanupError } = await provisioningClient.auth.admin.deleteUser(newUser.id);
      if (cleanupError) cleanupMessage = ` Account cleanup failed: ${cleanupError.message}`;
    } else {
      cleanupMessage = ' The Auth account was created but could not be linked; remove it from Supabase Auth before retrying.';
    }
    return NextResponse.json(
      { error: `${createEmployeeError?.message ?? 'Could not create employee record.'}${cleanupMessage}` },
      { status: 500 }
    );
  }

  const { data: employee, error: employeeError } = await context.supabase
    .from('employees')
    .select('id, full_name, role, email, user_id, hourly_rate, phone, is_active, hired_date, employment_type, hours_worked, salary_paid, last_paid_at')
    .eq('id', employeeId)
    .single();
  if (employeeError) return NextResponse.json({ error: employeeError.message }, { status: 500 });

  return NextResponse.json({
    employee: {
      ...employee,
      hourly_rate: Number(employee.hourly_rate),
      hours_worked: Number(employee.hours_worked),
      salary_paid: Boolean(employee.salary_paid),
      is_active: Boolean(employee.is_active),
    },
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: EmployeeRequest;
  try {
    body = await request.json() as EmployeeRequest;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  if (typeof body.employee_id !== 'string' || (body.role !== 'Barista' && body.role !== 'Admin')) {
    return NextResponse.json({ error: 'A valid employee ID and role are required.' }, { status: 400 });
  }

  const context = await getAdminRequestContext();
  if ('response' in context) return context.response;
  if (body.role === 'Admin' && !context.isHQOwner) {
    return NextResponse.json({ error: 'Only the HQ Owner can promote employees to Admin.' }, { status: 403 });
  }
  const { error } = await context.supabase.rpc('update_franchise_employee_role', {
    p_employee_id: body.employee_id,
    p_role: body.role,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  let body: EmployeeRequest;
  try {
    body = await request.json() as EmployeeRequest;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  if (typeof body.employee_id !== 'string') {
    return NextResponse.json({ error: 'A valid employee ID is required.' }, { status: 400 });
  }

  const context = await getAdminRequestContext();
  if ('response' in context) return context.response;
  const { data: employee, error: employeeError } = await context.supabase
    .from('employees')
    .select('user_id')
    .eq('id', body.employee_id)
    .single();
  if (employeeError) return NextResponse.json({ error: employeeError.message }, { status: 404 });

  if (employee.user_id) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Configure SUPABASE_SERVICE_ROLE_KEY to remove an employee with an active login safely.' },
        { status: 500 }
      );
    }
    const adminClient = createSupabaseAdminClient();
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(employee.user_id);
    if (deleteUserError) return NextResponse.json({ error: deleteUserError.message }, { status: 400 });
  }

  const { error } = await context.supabase.rpc('remove_franchise_employee', {
    p_employee_id: body.employee_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
