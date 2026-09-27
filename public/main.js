const state = {
  mode: "login",
  token: localStorage.getItem("agriscan_token") || "",
  user: JSON.parse(localStorage.getItem("agriscan_user") || "null"),
  inspections: []
};

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function setMode(mode) {
  state.mode = mode;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.auth === mode);
  });

  $("nameGroup").classList.toggle("hidden", mode !== "register");
  $("authSubmit").textContent = mode === "login" ? "Login" : "Create account";
}

function showApp() {
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("welcomeText").textContent = state.user
    ? `Welcome, ${state.user.name}`
    : "";
  loadInspections();
}

function showAuth() {
  $("appView").classList.add("hidden");
  $("authView").classList.remove("hidden");
}

async function api(url, options = {}) {
  const headers = options.headers || {};

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });

  let data = {};
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("name").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;

  try {
    const data = await api(
      state.mode === "login"
        ? "/api/auth/login"
        : "/api/auth/register",
      {
        method: "POST",
        body: JSON.stringify(
          state.mode === "login"
            ? { email, password }
            : { name, email, password }
        )
      }
    );

    state.token = data.token;
    state.user = data.user;

    localStorage.setItem("agriscan_token", state.token);
    localStorage.setItem("agriscan_user", JSON.stringify(state.user));

    $("authForm").reset();
    showToast(data.message);
    showApp();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.auth));
});

$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("agriscan_token");
  localStorage.removeItem("agriscan_user");
  state.token = "";
  state.user = null;
  showAuth();
});

$("newInspectionBtn").addEventListener("click", openModal);
$("closeModal").addEventListener("click", closeModal);
$("cancelInspection").addEventListener("click", closeModal);

function openModal() {
  $("inspectionModal").classList.remove("hidden");
  $("inspectionDate").value = new Date().toISOString().slice(0, 16);
}

function closeModal() {
  $("inspectionModal").classList.add("hidden");
  $("inspectionForm").reset();
  $("imagePreview").innerHTML = "";
}

$("inspectionImages").addEventListener("change", () => {
  const preview = $("imagePreview");
  preview.innerHTML = "";

  [...$("inspectionImages").files].slice(0, 5).forEach((file) => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  });
});

$("inspectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("saveInspection");
  button.disabled = true;
  button.textContent = "Saving...";

  try {
    let imageUrls = [];
    const files = [...$("inspectionImages").files].slice(0, 5);

    if (files.length) {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));

      const uploadResult = await api("/api/uploads", {
        method: "POST",
        body: formData
      });

      imageUrls = uploadResult.urls;
    }

    await api("/api/inspections", {
      method: "POST",
      body: JSON.stringify({
        title: $("inspectionTitle").value.trim(),
        category: $("inspectionCategory").value,
        cropOrEquipment: $("cropOrEquipment").value.trim(),
        notes: $("inspectionNotes").value.trim(),
        status: $("inspectionStatus").value,
        inspectionDate: $("inspectionDate").value,
        imageUrls
      })
    });

    closeModal();
    showToast("Inspection saved successfully.");
    loadInspections();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Save Inspection";
  }
});

async function loadInspections() {
  const params = new URLSearchParams();

  const search = $("searchInput").value.trim();
  const category = $("categoryFilter").value;
  const status = $("statusFilter").value;
  const date = $("dateFilter").value;

  if (search) params.set("search", search);
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (date) params.set("date", date);

  try {
    const data = await api(`/api/inspections?${params.toString()}`);
    state.inspections = data.inspections;
    renderInspections();
  } catch (error) {
    if (error.message.toLowerCase().includes("token")) {
      state.token = "";
      localStorage.removeItem("agriscan_token");
      showAuth();
    } else {
      showToast(error.message);
    }
  }
}

function renderInspections() {
  const list = $("inspectionList");

  updateStats();

  if (!state.inspections.length) {
    list.innerHTML = `
      <div class="empty">
        <h3>No inspections found</h3>
        <p>Create your first field inspection using the button above.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = state.inspections.map((item) => {
    const date = new Date(item.inspectionDate).toLocaleString();
    const images = item.images.map(
      (image) => `<img src="${escapeAttr(image.imageUrl)}" alt="Inspection photo">`
    ).join("");

    return `
      <article class="inspection-card">
        <div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <div class="meta">
            ${escapeHtml(item.category)} ·
            ${escapeHtml(item.cropOrEquipment)} ·
            ${escapeHtml(date)}
          </div>
          <span class="badge ${item.status}">
            ${escapeHtml(item.status)}
          </span>
          <p class="notes">${escapeHtml(item.notes || "No notes added.")}</p>
          ${images ? `<div class="card-images">${images}</div>` : ""}
        </div>

        <div class="card-actions">
          <select onchange="changeStatus(${item.id}, this.value)">
            <option value="PENDING" ${item.status === "PENDING" ? "selected" : ""}>Pending</option>
            <option value="CRITICAL" ${item.status === "CRITICAL" ? "selected" : ""}>Critical</option>
            <option value="RESOLVED" ${item.status === "RESOLVED" ? "selected" : ""}>Resolved</option>
          </select>
          <button class="outline" onclick="deleteInspection(${item.id})">Delete</button>
        </div>
      </article>
    `;
  }).join("");
}

function updateStats() {
  $("totalCount").textContent = state.inspections.length;
  $("pendingCount").textContent =
    state.inspections.filter((x) => x.status === "PENDING").length;
  $("criticalCount").textContent =
    state.inspections.filter((x) => x.status === "CRITICAL").length;
  $("resolvedCount").textContent =
    state.inspections.filter((x) => x.status === "RESOLVED").length;
}

async function changeStatus(id, status) {
  try {
    await api(`/api/inspections/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });

    showToast("Status updated.");
    loadInspections();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteInspection(id) {
  if (!confirm("Delete this inspection?")) return;

  try {
    await api(`/api/inspections/${id}`, { method: "DELETE" });
    showToast("Inspection deleted.");
    loadInspections();
  } catch (error) {
    showToast(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

let searchTimer;
["searchInput", "categoryFilter", "statusFilter", "dateFilter"].forEach((id) => {
  $(id).addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadInspections, 250);
  });
});

$("clearFilters").addEventListener("click", () => {
  $("searchInput").value = "";
  $("categoryFilter").value = "";
  $("statusFilter").value = "";
  $("dateFilter").value = "";
  loadInspections();
});

window.changeStatus = changeStatus;
window.deleteInspection = deleteInspection;

(async function init() {
  if (!state.token) {
    showAuth();
    return;
  }

  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    localStorage.setItem("agriscan_user", JSON.stringify(state.user));
    showApp();
  } catch {
    localStorage.removeItem("agriscan_token");
    localStorage.removeItem("agriscan_user");
    state.token = "";
    state.user = null;
    showAuth();
  }
})();