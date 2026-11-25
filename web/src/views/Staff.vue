<template>
  <div>
    <div class="page-header">
      <div>
        <h2>Manajemen Staf & Registrasi Undangan</h2>
        <p class="page-subtitle">Kelola data staf klinik dan aktivasi akun melalui token undangan</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Staf Terdaftar</h3>
        </div>

        <div v-if="staffList.length > 0">
          <div
            v-for="s in staffList"
            :key="s.id"
            style="display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--border);"
          >
            <div>
              <div style="font-weight: 600;">{{ s.name }}</div>
              <div class="muted text-xs">{{ s.email }} — {{ s.clinic_name }}</div>
            </div>
            <span class="badge" :class="roleBadge(s.role)">{{ s.role }}</span>
          </div>
        </div>
        <div v-else class="state" style="padding: 24px 0;">
          Gunakan akun admin atau manajer untuk melihat daftar lengkap staf.
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Klaim Token Undangan Staf Baru</h3>
        </div>
        <p class="page-subtitle" style="margin-bottom: 16px;">
          Calon pegawai mengaktifkan akun melalui token undangan resmi klinik.
        </p>

        <form @submit.prevent="submitAcceptInvitation">
          <div class="field">
            <label class="label" for="invite_token">Token Undangan</label>
            <input id="invite_token" v-model="inviteForm.token" class="input mono" type="text" required />
            <div class="field-hint">
              Token lab siap pakai:
              <code class="inline-code">INVITE-TOKEN-MNT-9988</code>
              atau
              <code class="inline-code">INVITE-TOKEN-SNT-7766</code>
            </div>
          </div>

          <div class="field">
            <label class="label" for="invite_name">Nama Lengkap</label>
            <input id="invite_name" v-model="inviteForm.name" class="input" type="text" required />
          </div>

          <div class="field">
            <label class="label" for="invite_password">Kata Sandi Baru</label>
            <input id="invite_password" v-model="inviteForm.password" class="input" type="password" required />
          </div>

          <div class="field">
            <label class="label" for="invite_role">Role Hak Akses</label>
            <select id="invite_role" v-model="inviteForm.role" class="select">
              <option value="staff">staff (Staf Pendaftaran)</option>
              <option value="cashier">cashier (Kasir Poliklinik)</option>
              <option value="manager">manager (Koordinator Operasional)</option>
              <option value="admin">admin (Administrator Pusat)</option>
            </select>
          </div>

          <div style="display: flex; justify-content: flex-end;">
            <button type="submit" class="btn btn-primary btn-sm" :disabled="claiming">
              {{ claiming ? 'Mendaftarkan...' : 'Aktifkan Akun Staf' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '../api';

const staffList = ref<any[]>([]);
const claiming = ref(false);

const inviteForm = ref({
  token: 'INVITE-TOKEN-MNT-9988',
  name: 'Staf Percobaan',
  password: 'password123',
  phone: '0819999888',
  role: 'admin',
});

async function fetchStaff() {
  try {
    const res = await apiFetch('/staff');
    if (res.success && res.data) {
      staffList.value = res.data;
    }
  } catch (err) {
    console.error(err);
  }
}

async function submitAcceptInvitation() {
  claiming.value = true;
  try {
    const res = await apiFetch('/staff/accept-invitation', {
      method: 'POST',
      body: JSON.stringify(inviteForm.value),
    });

    if (res.success) {
      alert(`[SUKSES REGISTRASI UNDANGAN]\n${res.message}\nHak Akses: ${res.assigned_role}`);
      await fetchStaff();
    } else {
      alert(`Gagal: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  } finally {
    claiming.value = false;
  }
}

function roleBadge(role: string) {
  switch (role) {
    case 'admin': return 'badge-danger';
    case 'manager': return 'badge-warning';
    case 'staff': return 'badge-primary';
    case 'cashier': return 'badge-success';
    default: return 'badge-secondary';
  }
}

onMounted(() => {
  fetchStaff();
});
</script>
