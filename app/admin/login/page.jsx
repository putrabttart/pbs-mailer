"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace('/admin');
      }
    };
    checkSession();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError('');
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (authError) throw authError;
      router.replace('/admin');
    } catch (err) {
      setError(err.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-md-6 col-lg-4">
            <div className="bg-white rounded-3 shadow-sm p-4">
              <div className="d-flex align-items-center mb-3 gap-2">
                <div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" style={{ width: 40, height: 40 }}>
                  <i className="bi bi-shield-lock" />
                </div>
                <div>
                  <h5 className="mb-0">Admin Login</h5>
                  <small className="text-muted">Masuk dengan email & password Supabase</small>
                </div>
              </div>

              {error && (
                <div className="alert alert-danger py-2" role="alert">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="d-grid gap-3">
                <div>
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="admin@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                      Masuk...
                    </>
                  ) : (
                    'Login Admin'
                  )}
                </button>
              </form>

              <div className="d-flex align-items-center justify-content-between">
                <Link href="/" className="text-decoration-none">
                  <i className="bi bi-arrow-left" /> Kembali ke user
                </Link>
                <small className="text-muted">Hanya admin yang diizinkan</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
