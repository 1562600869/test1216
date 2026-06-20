const API_BASE = '';

const MODEL_TYPES = ['街车', '跑车', '越野', '巡航', '复古'];
const MODIFY_TYPES = ['排气', '悬挂', '外观', '动力', '电气'];
const STATUS_FLOW = { '待施工': '施工中', '施工中': '已完成' };
const STATUS_COLORS = {
    '待施工': 'badge-wait',
    '施工中': 'badge-doing',
    '已完成': 'badge-done',
    '已取消': 'badge-cancel'
};

let currentModal = null;

async function api(url, options = {}) {
    const res = await fetch(API_BASE + url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || '请求失败');
    }
    return data;
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast toast-${type}`;
    setTimeout(() => t.classList.add('hidden'), 2500);
}

function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusBadge(status) {
    return `<span class="badge ${STATUS_COLORS[status] || ''}">${esc(status)}</span>`;
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            if (btn.dataset.tab === 'stats') {
                loadMonthlyStats();
            }
        });
    });
}

async function loadVehicles() {
    const list = await api('/api/vehicles');
    const tbody = document.querySelector('#vehicles-table tbody');
    tbody.innerHTML = list.map(v => `
        <tr>
            <td>${esc(v.plate)}</td>
            <td>${esc(v.model_type)}</td>
            <td>${esc(v.owner_name)}</td>
            <td>${esc(v.owner_phone)}</td>
            <td>${v.displacement}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick="editVehicle('${encodeURIComponent(v.plate)}')">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="deleteVehicle('${encodeURIComponent(v.plate)}')">删除</button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="empty">暂无车辆数据</td></tr>';

    const plateSelect = document.getElementById('order-plate');
    plateSelect.innerHTML = list.length
        ? '<option value="">请选择车牌</option>' + list.map(v =>
            `<option value="${esc(v.plate)}">${esc(v.plate)} - ${esc(v.owner_name)}</option>`
        ).join('')
        : '<option value="">请先添加车辆</option>';
}

async function submitVehicle(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
        plate: fd.get('plate').trim(),
        model_type: fd.get('model_type'),
        owner_name: fd.get('owner_name').trim(),
        owner_phone: fd.get('owner_phone').trim(),
        displacement: parseInt(fd.get('displacement'))
    };
    try {
        await api('/api/vehicles', { method: 'POST', body: JSON.stringify(data) });
        showToast('车辆添加成功');
        e.target.reset();
        loadVehicles();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteVehicle(plateEncoded) {
    const plate = decodeURIComponent(plateEncoded);
    if (!confirm(`确定删除车辆 ${plate} 吗？`)) return;
    try {
        await api(`/api/vehicles/${plateEncoded}`, { method: 'DELETE' });
        showToast('车辆已删除');
        loadVehicles();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function editVehicle(plateEncoded) {
    const plate = decodeURIComponent(plateEncoded);
    openModal('编辑车辆信息', async (modalBody) => {
        const list = await api('/api/vehicles');
        const v = list.find(x => x.plate === plate);
        if (!v) return '车辆不存在';
        return `
            <div class="form-grid">
                <div class="form-group">
                    <label>车牌</label>
                    <input type="text" id="ev-plate" value="${esc(v.plate)}" disabled>
                </div>
                <div class="form-group">
                    <label>车型</label>
                    <select id="ev-model_type">
                        ${MODEL_TYPES.map(m => `<option ${m === v.model_type ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>车主姓名</label>
                    <input type="text" id="ev-owner_name" value="${esc(v.owner_name)}">
                </div>
                <div class="form-group">
                    <label>联系电话</label>
                    <input type="text" id="ev-owner_phone" value="${esc(v.owner_phone)}">
                </div>
                <div class="form-group">
                    <label>排量(cc)</label>
                    <input type="number" id="ev-displacement" min="1" value="${v.displacement}">
                </div>
            </div>
        `;
    }, async () => {
        const data = {
            model_type: document.getElementById('ev-model_type').value,
            owner_name: document.getElementById('ev-owner_name').value.trim(),
            owner_phone: document.getElementById('ev-owner_phone').value.trim(),
            displacement: parseInt(document.getElementById('ev-displacement').value)
        };
        await api(`/api/vehicles/${plateEncoded}`, {
            method: 'PUT', body: JSON.stringify(data)
        });
        showToast('车辆信息已更新');
        loadVehicles();
    });
}

async function loadOrders() {
    const list = await api('/api/orders');
    const tbody = document.querySelector('#orders-table tbody');
    tbody.innerHTML = list.map(o => {
        const canAdvance = STATUS_FLOW[o.status];
        const canCancel = o.status === '待施工';
        const canEdit = o.status !== '已取消';
        return `
        <tr>
            <td>${o.id}</td>
            <td>${esc(o.plate)}</td>
            <td>${esc(o.owner_name)}</td>
            <td>${esc(o.modify_type)}</td>
            <td>${esc(o.order_date)}</td>
            <td>${o.cost}</td>
            <td>${statusBadge(o.status)}</td>
            <td>
                ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="editOrder(${o.id})">编辑</button>` : ''}
                ${canAdvance ? `<button class="btn btn-sm btn-primary" onclick="advanceOrder(${o.id})">推进→${esc(STATUS_FLOW[o.status])}</button>` : ''}
                ${canCancel ? `<button class="btn btn-sm btn-warning" onclick="cancelOrder(${o.id})">取消</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteOrder(${o.id})">删除</button>
            </td>
        </tr>
        `;
    }).join('') || '<tr><td colspan="8" class="empty">暂无工单数据</td></tr>';
}

async function submitOrder(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
        plate: fd.get('plate'),
        modify_type: fd.get('modify_type'),
        order_date: fd.get('order_date'),
        cost: parseInt(fd.get('cost'))
    };
    try {
        await api('/api/orders', { method: 'POST', body: JSON.stringify(data) });
        showToast('工单创建成功');
        e.target.reset();
        document.querySelector('input[name="order_date"]').value = todayStr();
        loadOrders();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function advanceOrder(id) {
    try {
        const r = await api(`/api/orders/${id}`, {
            method: 'PUT', body: JSON.stringify({ action: 'advance' })
        });
        showToast(r.message);
        loadOrders();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function cancelOrder(id) {
    if (!confirm('确定取消该工单吗？此操作不可撤销。')) return;
    try {
        const r = await api(`/api/orders/${id}`, {
            method: 'PUT', body: JSON.stringify({ action: 'cancel' })
        });
        showToast(r.message);
        loadOrders();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteOrder(id) {
    if (!confirm(`确定删除工单 #${id} 吗？`)) return;
    try {
        await api(`/api/orders/${id}`, { method: 'DELETE' });
        showToast('工单已删除');
        loadOrders();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function editOrder(id) {
    openModal(`编辑工单 #${id}`, async (modalBody) => {
        const orders = await api('/api/orders');
        const vehicles = await api('/api/vehicles');
        const o = orders.find(x => x.id === id);
        if (!o) return '工单不存在';
        return `
            <div class="form-grid">
                <div class="form-group">
                    <label>车辆车牌</label>
                    <select id="eo-plate">
                        ${vehicles.map(v =>
                            `<option value="${esc(v.plate)}" ${v.plate === o.plate ? 'selected' : ''}>${esc(v.plate)} - ${esc(v.owner_name)}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>改装类型</label>
                    <select id="eo-modify_type">
                        ${MODIFY_TYPES.map(m => `<option ${m === o.modify_type ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>工单日期</label>
                    <input type="date" id="eo-order_date" value="${esc(o.order_date)}">
                </div>
                <div class="form-group">
                    <label>费用(分)</label>
                    <input type="number" id="eo-cost" min="0" value="${o.cost}">
                </div>
                <div class="form-group">
                    <label>当前状态</label>
                    <span>${statusBadge(o.status)}</span>
                </div>
            </div>
        `;
    }, async () => {
        const data = {
            action: 'update',
            plate: document.getElementById('eo-plate').value,
            modify_type: document.getElementById('eo-modify_type').value,
            order_date: document.getElementById('eo-order_date').value,
            cost: parseInt(document.getElementById('eo-cost').value)
        };
        await api(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('工单已更新');
        loadOrders();
    });
}

async function queryOwner() {
    const name = document.getElementById('owner-query').value.trim();
    if (!name) {
        showToast('请输入车主姓名', 'error');
        return;
    }
    try {
        const r = await api(`/api/orders/by-owner?owner_name=${encodeURIComponent(name)}`);
        document.getElementById('owner-result').classList.remove('hidden');
        document.getElementById('owner-total').textContent = r.total_cost;
        const tbody = document.querySelector('#owner-orders-table tbody');
        tbody.innerHTML = r.orders.map(o => `
            <tr>
                <td>${o.id}</td>
                <td>${esc(o.plate)}</td>
                <td>${esc(o.model_type)}</td>
                <td>${esc(o.modify_type)}</td>
                <td>${esc(o.order_date)}</td>
                <td>${o.cost}</td>
                <td>${statusBadge(o.status)}</td>
            </tr>
        `).join('') || '<tr><td colspan="7" class="empty">该车主暂无工单</td></tr>';
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadMonthlyStats() {
    const rows = await api('/api/stats/monthly');
    const tbody = document.querySelector('#monthly-stats-table tbody');
    const totals = { count: 0, total: 0 };
    tbody.innerHTML = rows.map(r => {
        totals.count += r.count;
        totals.total += r.total;
        return `
            <tr>
                <td>${esc(r.modify_type)}</td>
                <td>${r.count}</td>
                <td>${r.total}</td>
            </tr>
        `;
    }).join('') + (rows.length ? `
        <tr class="total-row">
            <td><strong>合计</strong></td>
            <td><strong>${totals.count}</strong></td>
            <td><strong>${totals.total}</strong></td>
        </tr>
    ` : '<tr><td colspan="3" class="empty">本月暂无数据</td></tr>');
}

function openModal(title, bodyBuilder, onConfirm) {
    closeModal();
    const modal = document.getElementById('edit-modal');
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.innerHTML = '<p class="loading">加载中...</p>';
    modal.classList.remove('hidden');

    Promise.resolve(bodyBuilder(body)).then(html => {
        if (html) body.innerHTML = html;
    }).catch(err => {
        body.innerHTML = `<p class="error-msg">${esc(err.message)}</p>`;
    });

    currentModal = { onConfirm };
}

function closeModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    currentModal = null;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function init() {
    initTabs();

    document.getElementById('vehicle-form').addEventListener('submit', submitVehicle);
    document.getElementById('order-form').addEventListener('submit', submitOrder);
    document.getElementById('owner-query-btn').addEventListener('click', queryOwner);
    document.getElementById('refresh-stats-btn').addEventListener('click', loadMonthlyStats);

    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-confirm').addEventListener('click', async () => {
        if (!currentModal) return;
        try {
            await currentModal.onConfirm();
            closeModal();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    document.getElementById('edit-modal').addEventListener('click', (e) => {
        if (e.target.id === 'edit-modal') closeModal();
    });

    document.querySelector('input[name="order_date"]').value = todayStr();

    loadVehicles();
    loadOrders();
}

document.addEventListener('DOMContentLoaded', init);
