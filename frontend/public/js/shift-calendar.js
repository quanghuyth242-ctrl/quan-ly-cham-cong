(() => {
    'use strict';

    // 1. Quản lý chuyển đổi chế độ xem (Lịch phân ca / Danh sách)
    const toggleCalendarBtn = document.getElementById('toggle-view-calendar');
    const toggleListBtn = document.getElementById('toggle-view-list');
    const calendarContainer = document.getElementById('calendar-view-container');
    const listContainer = document.getElementById('list-view-container');

    const setViewMode = (mode) => {
        const isCalendar = mode === 'calendar';
        if (calendarContainer && listContainer) {
            calendarContainer.classList.toggle('hidden', !isCalendar);
            listContainer.classList.toggle('hidden', isCalendar);
        }

        if (toggleCalendarBtn && toggleListBtn) {
            if (isCalendar) {
                toggleCalendarBtn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
                toggleCalendarBtn.classList.remove('text-on-surface-variant', 'hover:text-primary');
                toggleCalendarBtn.setAttribute('aria-selected', 'true');

                toggleListBtn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
                toggleListBtn.classList.add('text-on-surface-variant', 'hover:text-primary');
                toggleListBtn.setAttribute('aria-selected', 'false');
            } else {
                toggleListBtn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
                toggleListBtn.classList.remove('text-on-surface-variant', 'hover:text-primary');
                toggleListBtn.setAttribute('aria-selected', 'true');

                toggleCalendarBtn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
                toggleCalendarBtn.classList.add('text-on-surface-variant', 'hover:text-primary');
                toggleCalendarBtn.setAttribute('aria-selected', 'false');
            }
        }

        try {
            localStorage.setItem('shift_schedule_view_mode', mode);
            const url = new URL(window.location.href);
            url.searchParams.set('view', mode);
            window.history.replaceState({}, '', url.toString());
        } catch {
            // bỏ qua nếu localStorage hoặc URL bị hạn chế
        }
    };

    if (toggleCalendarBtn && toggleListBtn) {
        toggleCalendarBtn.addEventListener('click', () => setViewMode('calendar'));
        toggleListBtn.addEventListener('click', () => setViewMode('list'));

        // Kiểm tra ưu tiên: URL param > localStorage > mặc định
        const urlParams = new URLSearchParams(window.location.search);
        const urlView = urlParams.get('view');
        if (urlView === 'list' || urlView === 'calendar') {
            setViewMode(urlView);
        } else {
            const savedMode = localStorage.getItem('shift_schedule_view_mode');
            if (savedMode === 'list') {
                setViewMode('list');
            } else {
                setViewMode('calendar');
            }
        }
    }

    // 2. Định nghĩa màu sắc phân ca
    const getShiftColor = (shiftCode) => {
        switch (String(shiftCode || '').toUpperCase()) {
            case 'CA001': // Ca hành chính
                return {
                    bg: 'bg-blue-50/90 hover:bg-blue-100',
                    border: 'border-blue-200 hover:border-blue-300',
                    text: 'text-blue-900',
                    dot: 'bg-blue-600',
                    badge: 'bg-blue-100 text-blue-800'
                };
            case 'CA002': // Ca sáng
                return {
                    bg: 'bg-emerald-50/90 hover:bg-emerald-100',
                    border: 'border-emerald-200 hover:border-emerald-300',
                    text: 'text-emerald-900',
                    dot: 'bg-emerald-600',
                    badge: 'bg-emerald-100 text-emerald-800'
                };
            case 'CA003': // Ca chiều
                return {
                    bg: 'bg-amber-50/90 hover:bg-amber-100',
                    border: 'border-amber-200 hover:border-amber-300',
                    text: 'text-amber-900',
                    dot: 'bg-amber-600',
                    badge: 'bg-amber-100 text-amber-800'
                };
            case 'CA005': // Ca trực cuối tuần
                return {
                    bg: 'bg-purple-50/90 hover:bg-purple-100',
                    border: 'border-purple-200 hover:border-purple-300',
                    text: 'text-purple-900',
                    dot: 'bg-purple-600',
                    badge: 'bg-purple-100 text-purple-800'
                };
            case 'CA006': // Ca đêm
                return {
                    bg: 'bg-indigo-50/90 hover:bg-indigo-100',
                    border: 'border-indigo-200 hover:border-indigo-300',
                    text: 'text-indigo-900',
                    dot: 'bg-indigo-600',
                    badge: 'bg-indigo-100 text-indigo-800'
                };
            case 'CA007': // Ca bán thời gian
                return {
                    bg: 'bg-teal-50/90 hover:bg-teal-100',
                    border: 'border-teal-200 hover:border-teal-300',
                    text: 'text-teal-900',
                    dot: 'bg-teal-600',
                    badge: 'bg-teal-100 text-teal-800'
                };
            default:
                return {
                    bg: 'bg-primary-fixed/50 hover:bg-primary-fixed/80',
                    border: 'border-primary/20 hover:border-primary/40',
                    text: 'text-primary',
                    dot: 'bg-primary',
                    badge: 'bg-primary-fixed text-primary'
                };
        }
    };

    // 3. Quản lý Lịch tuần (Weekly Matrix Board)
    const calPrevBtn = document.getElementById('cal-prev-btn');
    const calNextBtn = document.getElementById('cal-next-btn');
    const calTodayBtn = document.getElementById('cal-today-btn');
    const calDatePicker = document.getElementById('cal-date-picker');
    const calPeriodTitle = document.getElementById('cal-period-title');
    const calDeptFilter = document.getElementById('cal-dept-filter');
    const calShiftFilter = document.getElementById('cal-shift-filter');
    const calSearchInput = document.getElementById('cal-search-input');
    const calPrintBtn = document.getElementById('cal-print-btn');
    const matrixTable = document.getElementById('cal-schedule-table');
    const matrixTbody = document.getElementById('cal-matrix-tbody');
    const matrixTfootRow = document.getElementById('cal-matrix-tfoot-row');
    const empCountBadge = document.getElementById('cal-emp-count-badge');

    let currentSelectedDate = (calDatePicker && calDatePicker.value) || new Date().toISOString().slice(0, 10);
    let isFetchingMatrix = false;

    const fetchAndRenderMatrix = async (date) => {
        if (isFetchingMatrix) return;
        isFetchingMatrix = true;

        if (matrixTbody) {
            matrixTbody.style.opacity = '0.5';
        }

        try {
            const dept = calDeptFilter ? calDeptFilter.value : '';
            const shift = calShiftFilter ? calShiftFilter.value : '';
            const search = calSearchInput ? calSearchInput.value.trim() : '';

            const params = new URLSearchParams({
                date: date || currentSelectedDate,
                department: dept,
                shift_id: shift,
                search: search
            });

            const response = await fetch(`/admin/shift-assignments/calendar-data?${params.toString()}`);
            if (!response.ok) throw new Error('Không thể tải dữ liệu lịch phân ca');

            const data = await response.json();
            if (!data.success) throw new Error(data.error || 'Dữ liệu không hợp lệ');

            renderMatrixTable(data);
            currentSelectedDate = data.weekInfo ? data.weekInfo.selectedDate : date;

            if (calDatePicker) calDatePicker.value = currentSelectedDate;
            if (calPrevBtn && data.weekInfo) calPrevBtn.dataset.date = data.weekInfo.prevWeekDate;
            if (calNextBtn && data.weekInfo) calNextBtn.dataset.date = data.weekInfo.nextWeekDate;

            if (calPeriodTitle && data.weekInfo) {
                const s = data.weekInfo.weekStart.split('-');
                const e = data.weekInfo.weekEnd.split('-');
                calPeriodTitle.textContent = `Tuần ${s[2]}/${s[1]} – ${e[2]}/${e[1]}/${e[0]}`;
            }

            const url = new URL(window.location.href);
            url.searchParams.set('date', currentSelectedDate);
            window.history.replaceState({}, '', url.toString());

        } catch (err) {
            console.error('Lỗi tải lịch tuần:', err);
        } finally {
            if (matrixTbody) matrixTbody.style.opacity = '1';
            isFetchingMatrix = false;
        }
    };

    const renderMatrixTable = (data) => {
        if (!matrixTable || !matrixTbody) return;

        const { days, employees, matrix, summary } = data;

        if (empCountBadge) {
            empCountBadge.textContent = `${employees.length} NV`;
        }

        // 1. Cập nhật THEAD (các cột ngày)
        const theadTr = matrixTable.querySelector('thead tr');
        if (theadTr) {
            const firstTh = theadTr.firstElementChild;
            theadTr.innerHTML = '';
            theadTr.appendChild(firstTh);

            days.forEach((day) => {
                const th = document.createElement('th');
                th.className = `py-3 px-2 text-center min-w-[130px] border-r border-surface-container-high/60 ${
                    day.isToday ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : (day.isWeekend ? 'bg-surface-container-high/30' : '')
                }`;

                th.innerHTML = `
                    <div class="flex flex-col items-center gap-0.5">
                        <span class="text-[12px] font-semibold ${day.isToday ? 'text-primary' : 'text-on-surface-variant'}">
                            ${day.weekdayLabel}
                        </span>
                        <div class="flex items-center gap-1">
                            <span class="font-data-mono text-[13px] font-bold ${
                                day.isToday
                                    ? 'px-2 py-0.5 rounded-full bg-primary text-on-primary'
                                    : (day.isWeekend ? 'text-amber-700' : 'text-on-surface')
                            }">
                                ${String(day.dayNumber).padStart(2, '0')}/${String(day.monthNumber).padStart(2, '0')}
                            </span>
                        </div>
                        ${day.isToday ? '<span class="text-[10px] uppercase font-bold text-primary tracking-wider">Hôm nay</span>' : ''}
                    </div>
                `;
                theadTr.appendChild(th);
            });
        }

        // 2. Cập nhật TBODY
        matrixTbody.innerHTML = '';

        if (employees.length === 0) {
            const emptyTr = document.createElement('tr');
            emptyTr.innerHTML = `
                <td colspan="${days.length + 1}" class="py-12 px-4 text-center text-on-surface-variant">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-symbols-outlined text-[36px] text-outline">group_off</span>
                        <span class="font-label-md">Không tìm thấy nhân viên nào phù hợp bộ lọc.</span>
                        <span class="text-[12px]">Hãy thử chọn lại phòng ban hoặc từ khóa tìm kiếm.</span>
                    </div>
                </td>
            `;
            matrixTbody.appendChild(emptyTr);
        } else {
            employees.forEach((emp) => {
                const tr = document.createElement('tr');
                tr.className = 'hover:bg-surface-container-low/60 transition-colors';
                tr.dataset.empRow = 'true';
                tr.dataset.empName = emp.full_name;
                tr.dataset.empCode = emp.employee_code;
                tr.dataset.empDept = emp.department || '';

                // Cột sticky nhân viên
                const empTd = document.createElement('td');
                empTd.className = 'py-2.5 px-3 sticky left-0 z-10 bg-surface-container-lowest border-r border-surface-container-high shadow-xs';
                const initials = emp.full_name.trim().slice(0, 2).toUpperCase();

                empTd.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-8 h-8 rounded-full bg-primary-fixed text-primary font-bold text-xs flex items-center justify-center shrink-0">
                                ${initials}
                            </div>
                            <div class="flex flex-col min-w-0">
                                <span class="font-label-md text-label-md text-on-surface font-semibold truncate" title="${emp.full_name}">
                                    ${emp.full_name}
                                </span>
                                <span class="font-data-mono text-[11px] text-on-surface-variant truncate">
                                    ${emp.employee_code}${emp.department ? ` · ${emp.department}` : ''}
                                </span>
                            </div>
                        </div>
                        <button
                            type="button"
                            class="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary-fixed/50 transition-colors shrink-0"
                            title="Xem lịch chi tiết của ${emp.full_name}"
                            data-view-employee-calendar
                            data-id="${emp.id}"
                            data-name="${emp.full_name}"
                            data-code="${emp.employee_code}"
                            data-dept="${emp.department || ''}"
                        >
                            <span class="material-symbols-outlined text-[18px]">calendar_month</span>
                        </button>
                    </div>
                `;
                tr.appendChild(empTd);

                // 7 Cột ngày
                days.forEach((day) => {
                    const cellTd = document.createElement('td');
                    cellTd.className = `p-1.5 border-r border-surface-container-high/50 align-top ${
                        day.isToday ? 'bg-primary/5' : (day.isWeekend ? 'bg-surface-container-high/15' : '')
                    }`;

                    const cellData = matrix[emp.id] && matrix[emp.id][day.dateStr];

                    if (cellData && cellData.type === 'work') {
                        const colors = getShiftColor(cellData.shiftCode);
                        const morningStr = cellData.morningTime || (cellData.morningStart ? `${cellData.morningStart} - ${cellData.morningEnd}` : '');
                        const afternoonStr = cellData.afternoonTime || (cellData.afternoonStart ? `${cellData.afternoonStart} - ${cellData.afternoonEnd}` : '');
                        const displayTime = cellData.morningStart && cellData.afternoonEnd
                            ? `${cellData.morningStart} - ${cellData.afternoonEnd}`
                            : (cellData.timeFormatted || '');

                        cellTd.innerHTML = `
                            <div
                                class="flex flex-col p-2 rounded-xl border ${colors.bg} ${colors.border} ${colors.text} cursor-pointer transition-all shadow-xs group"
                                data-cell-work
                                data-emp-id="${emp.id}"
                                data-emp-name="${emp.full_name}"
                                data-emp-code="${emp.employee_code}"
                                data-emp-dept="${emp.department || ''}"
                                data-date="${day.dateStr}"
                                data-date-label="${day.weekdayLabel}, ${String(day.dayNumber).padStart(2, '0')}/${String(day.monthNumber).padStart(2, '0')}/${day.dateStr.slice(0, 4)}"
                                data-shift-id="${cellData.shiftId}"
                                data-shift-code="${cellData.shiftCode}"
                                data-shift-name="${cellData.shiftName}"
                                data-morning="${morningStr}"
                                data-afternoon="${afternoonStr}"
                                data-start="${cellData.startDate}"
                                data-end="${cellData.endDate}"
                                data-note="${cellData.note || ''}"
                                data-assignment-id="${cellData.assignmentId}"
                                title="Bấm để xem chi tiết / điều chỉnh"
                            >
                                <div class="flex items-center gap-1 font-bold text-[12px] leading-tight truncate">
                                    <span class="w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0"></span>
                                    <span class="truncate">${cellData.shiftName}</span>
                                </div>
                                <span class="font-data-mono text-[11px] opacity-80 mt-1 truncate">
                                    ${displayTime}
                                </span>
                            </div>
                        `;
                    } else if (cellData && cellData.type === 'rest') {
                        cellTd.innerHTML = `
                            <div class="h-full min-h-[52px] flex flex-col items-center justify-center p-1.5 rounded-xl bg-surface-container-high/40 text-on-surface-variant/70 text-[11px] font-medium border border-dashed border-outline-variant/40" title="Nghỉ theo quy định ca ${cellData.shiftName || ''}">
                                <span class="material-symbols-outlined text-[16px] opacity-60">bedtime</span>
                                <span>Nghỉ ca</span>
                            </div>
                        `;
                    } else {
                        // Chưa phân ca
                        cellTd.innerHTML = `
                            <div
                                class="h-full min-h-[52px] flex items-center justify-center rounded-xl hover:bg-surface-container-high/50 border border-transparent hover:border-dashed hover:border-outline-variant/60 cursor-pointer group transition-all"
                                data-cell-add
                                data-emp-id="${emp.id}"
                                data-date="${day.dateStr}"
                                title="Phân ca cho ${emp.full_name} từ ${day.dateStr}"
                            >
                                <span class="material-symbols-outlined text-[18px] text-outline opacity-0 group-hover:opacity-100 transition-opacity">add</span>
                            </div>
                        `;
                    }

                    tr.appendChild(cellTd);
                });

                matrixTbody.appendChild(tr);
            });
        }

        // 3. Cập nhật TFOOT (Tổng nhân sự trực)
        if (matrixTfootRow) {
            matrixTfootRow.innerHTML = '';
            const tfootFirstTd = document.createElement('td');
            tfootFirstTd.className = 'py-3 px-3 sticky left-0 z-10 bg-surface-container-low border-r border-surface-container-high font-bold text-on-surface text-[12px] flex items-center gap-1.5';
            tfootFirstTd.innerHTML = `
                <span class="material-symbols-outlined text-[18px] text-primary">groups</span>
                <span>Tổng nhân sự đi làm</span>
            `;
            matrixTfootRow.appendChild(tfootFirstTd);

            days.forEach((day) => {
                const daySum = summary[day.dateStr] || { totalWorking: 0 };
                const count = daySum.totalWorking || 0;
                const td = document.createElement('td');
                td.className = `py-3 px-2 text-center border-r border-surface-container-high/50 ${
                    day.isToday ? 'bg-primary/5' : ''
                }`;
                td.innerHTML = `
                    <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[12px] font-bold ${
                        count > 0 ? 'bg-green-100 text-green-800' : 'bg-surface-container-high text-on-surface-variant'
                    }">
                        ${count} NV
                    </span>
                `;
                matrixTfootRow.appendChild(td);
            });
        }
    };

    // Điều hướng sự kiện nút tuần
    if (calPrevBtn) {
        calPrevBtn.addEventListener('click', () => {
            const prev = calPrevBtn.dataset.date;
            if (prev) fetchAndRenderMatrix(prev);
        });
    }

    if (calNextBtn) {
        calNextBtn.addEventListener('click', () => {
            const next = calNextBtn.dataset.date;
            if (next) fetchAndRenderMatrix(next);
        });
    }

    if (calTodayBtn) {
        calTodayBtn.addEventListener('click', () => {
            const today = new Date().toISOString().slice(0, 10);
            fetchAndRenderMatrix(today);
        });
    }

    if (calDatePicker) {
        calDatePicker.addEventListener('change', () => {
            if (calDatePicker.value) fetchAndRenderMatrix(calDatePicker.value);
        });
    }

    // Lọc nhanh trên Toolbar
    if (calDeptFilter) {
        calDeptFilter.addEventListener('change', () => fetchAndRenderMatrix(currentSelectedDate));
    }

    if (calShiftFilter) {
        calShiftFilter.addEventListener('change', () => fetchAndRenderMatrix(currentSelectedDate));
    }

    let searchDebounceTimer = null;
    if (calSearchInput) {
        calSearchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                fetchAndRenderMatrix(currentSelectedDate);
            }, 350);
        });
    }

    // Nút in lịch
    if (calPrintBtn) {
        calPrintBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // 4. Modal Chi tiết ca làm việc trong ô (Cell Detail Modal)
    const cellDetailModal = document.getElementById('shift-cell-detail-modal');
    const cellDetailEmpName = document.getElementById('cell-detail-emp-name');
    const cellDetailEmpMeta = document.getElementById('cell-detail-emp-meta');
    const cellDetailAvatar = document.getElementById('cell-detail-avatar');
    const cellDetailDateBadge = document.getElementById('cell-detail-date-badge');
    const cellDetailShiftName = document.getElementById('cell-detail-shift-name');
    const cellDetailMorning = document.getElementById('cell-detail-morning');
    const cellDetailAfternoon = document.getElementById('cell-detail-afternoon');
    const cellDetailPeriod = document.getElementById('cell-detail-period');
    const cellDetailNote = document.getElementById('cell-detail-note');
    const cellDetailEditAssignBtn = document.getElementById('cell-detail-edit-assign-btn');
    const cellDetailViewEmpCalBtn = document.getElementById('cell-detail-view-emp-cal-btn');

    let currentCellData = null;

    const openCellDetailModal = (dataset) => {
        currentCellData = dataset;
        if (!cellDetailModal) return;

        if (cellDetailEmpName) cellDetailEmpName.textContent = dataset.empName || '';
        if (cellDetailEmpMeta) cellDetailEmpMeta.textContent = `${dataset.empCode || ''}${dataset.empDept ? ` · ${dataset.empDept}` : ''}`;
        if (cellDetailAvatar) cellDetailAvatar.textContent = (dataset.empName || 'NV').slice(0, 2).toUpperCase();
        if (cellDetailDateBadge) cellDetailDateBadge.textContent = dataset.dateLabel || dataset.date || '';
        if (cellDetailShiftName) cellDetailShiftName.textContent = `${dataset.shiftName || ''} (${dataset.shiftCode || ''})`;
        if (cellDetailMorning) cellDetailMorning.textContent = dataset.morning || '—';
        if (cellDetailAfternoon) cellDetailAfternoon.textContent = dataset.afternoon || '—';
        if (cellDetailPeriod) cellDetailPeriod.textContent = `${dataset.start || ''} đến ${dataset.end || ''}`;
        if (cellDetailNote) cellDetailNote.textContent = dataset.note || 'Không có ghi chú';

        cellDetailModal.classList.remove('hidden');
        document.body.classList.add('shift-modal-open');
    };

    const closeCellDetailModal = () => {
        if (cellDetailModal) cellDetailModal.classList.add('hidden');
        document.body.classList.remove('shift-modal-open');
    };

    document.querySelectorAll('[data-close-cell-detail]').forEach((btn) => {
        btn.addEventListener('click', closeCellDetailModal);
    });

    // 5. Modal Điều chỉnh ca làm việc (Shift Adjustment Modal)
    const adjustModal = document.getElementById('adjust-shift-modal');
    const adjustForm = document.getElementById('adjust-shift-form');
    const adjustReturnView = document.getElementById('adjust_return_view');
    const adjustReturnDate = document.getElementById('adjust_return_date');
    const adjustFormError = document.getElementById('adjust-form-error');
    const adjustFormErrorText = document.getElementById('adjust-form-error-text');
    const adjustEmpAvatar = document.getElementById('adjust-emp-avatar');
    const adjustEmpName = document.getElementById('adjust-emp-name');
    const adjustEmpMeta = document.getElementById('adjust-emp-meta');
    const adjustCurrentShiftName = document.getElementById('adjust-current-shift-name');
    const adjustCurrentShiftTime = document.getElementById('adjust-current-shift-time');
    const adjustCurrentPeriod = document.getElementById('adjust-current-period');
    const adjustShiftSelect = document.getElementById('adjust_shift_select');
    const adjustShiftHint = document.getElementById('adjust-shift-hint');
    const adjustEffectiveDate = document.getElementById('adjust_effective_date');
    const adjustDateLimitHint = document.getElementById('adjust-date-limit-hint');
    const adjustPreviewText = document.getElementById('adjust-preview-text');
    const adjustNote = document.getElementById('adjust_note');

    let currentAdjustData = null;

    const showAdjustError = (msg) => {
        if (!adjustFormError || !adjustFormErrorText) return;
        adjustFormErrorText.textContent = msg;
        adjustFormError.classList.remove('hidden');
        adjustFormError.classList.add('flex');
    };

    const clearAdjustError = () => {
        if (!adjustFormError || !adjustFormErrorText) return;
        adjustFormErrorText.textContent = '';
        adjustFormError.classList.add('hidden');
        adjustFormError.classList.remove('flex');
    };

    const getPrevDay = (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
        return date.toISOString().slice(0, 10);
    };

    const updateAdjustPreview = () => {
        if (!currentAdjustData || !adjustPreviewText) return;

        const effectiveDate = adjustEffectiveDate.value;
        const selectedOption = adjustShiftSelect.selectedOptions[0];
        const newShiftName = selectedOption && selectedOption.value ? selectedOption.dataset.name : '';
        const currentShiftName = currentAdjustData.currentShiftName || currentAdjustData.shiftName || 'ca hiện tại';

        if (adjustShiftHint) {
            if (selectedOption && selectedOption.value) {
                const time = selectedOption.dataset.time || '';
                const workdays = selectedOption.dataset.workdays || '';
                adjustShiftHint.textContent = `${selectedOption.dataset.code} · ${time}${workdays ? ` · ${workdays}` : ''}`;
            } else {
                adjustShiftHint.textContent = '';
            }
        }

        if (!effectiveDate) {
            adjustPreviewText.textContent = 'Vui lòng chọn ngày hiệu lực áp dụng ca mới.';
            return;
        }

        if (effectiveDate < currentAdjustData.start || effectiveDate > currentAdjustData.end) {
            adjustPreviewText.innerHTML = `<span class="text-error font-semibold">Ngày hiệu lực phải nằm trong khoảng từ ${currentAdjustData.start} đến ${currentAdjustData.end}.</span>`;
            return;
        }

        const newShiftLabel = newShiftName ? `<strong>${newShiftName}</strong>` : 'ca mới';
        if (effectiveDate === currentAdjustData.start) {
            adjustPreviewText.innerHTML = `Toàn bộ khoảng thời gian từ <strong>${currentAdjustData.start}</strong> đến <strong>${currentAdjustData.end}</strong> sẽ được đổi sang ${newShiftLabel}.`;
        } else {
            const prev = getPrevDay(effectiveDate);
            adjustPreviewText.innerHTML = `Lịch cũ (<strong>${currentShiftName}</strong>) giữ nguyên từ <strong>${currentAdjustData.start}</strong> đến <strong>${prev}</strong>. ${newShiftLabel} sẽ bắt đầu áp dụng từ <strong>${effectiveDate}</strong> đến hết <strong>${currentAdjustData.end}</strong>.`;
        }
    };

    const openAdjustShiftModal = (data) => {
        currentAdjustData = {
            id: data.id || data.assignmentId,
            empName: data.employeeName || data.empName || '',
            empCode: data.employeeCode || data.empCode || '',
            empDept: data.department || data.empDept || '',
            currentShiftId: String(data.currentShiftId || data.shiftId || ''),
            currentShiftName: data.currentShiftName || data.shiftName || '',
            currentShiftTime: data.currentShiftTime || (data.morning && data.afternoon ? `${data.morning} | ${data.afternoon}` : ''),
            start: data.start || '',
            end: data.end || '',
            note: data.note || '',
            preferredEffectiveDate: data.preferredEffectiveDate || data.date || ''
        };

        if (!adjustModal || !adjustForm) return;

        adjustForm.action = `/admin/shift-assignments/${currentAdjustData.id}/adjust`;
        if (adjustReturnView) {
            adjustReturnView.value = localStorage.getItem('shift_schedule_view_mode') || 'calendar';
        }
        if (adjustReturnDate) {
            adjustReturnDate.value = currentAdjustData.preferredEffectiveDate || currentSelectedDate || '';
        }

        if (adjustEmpAvatar) {
            adjustEmpAvatar.textContent = (currentAdjustData.empName || 'NV').slice(0, 2).toUpperCase();
        }
        if (adjustEmpName) {
            adjustEmpName.textContent = currentAdjustData.empName;
        }
        if (adjustEmpMeta) {
            adjustEmpMeta.textContent = `${currentAdjustData.empCode}${currentAdjustData.empDept ? ` · ${currentAdjustData.empDept}` : ''}`;
        }
        if (adjustCurrentShiftName) {
            adjustCurrentShiftName.textContent = currentAdjustData.currentShiftName;
        }
        if (adjustCurrentShiftTime) {
            adjustCurrentShiftTime.textContent = currentAdjustData.currentShiftTime || '—';
        }
        if (adjustCurrentPeriod) {
            adjustCurrentPeriod.textContent = `${currentAdjustData.start} đến ${currentAdjustData.end}`;
        }

        // Set min/max cho ngày hiệu lực
        if (adjustEffectiveDate) {
            adjustEffectiveDate.min = currentAdjustData.start;
            adjustEffectiveDate.max = currentAdjustData.end;

            // Mặc định ngày hiệu lực:
            const today = new Date().toISOString().slice(0, 10);
            if (currentAdjustData.preferredEffectiveDate && currentAdjustData.preferredEffectiveDate >= currentAdjustData.start && currentAdjustData.preferredEffectiveDate <= currentAdjustData.end) {
                adjustEffectiveDate.value = currentAdjustData.preferredEffectiveDate;
            } else if (today >= currentAdjustData.start && today <= currentAdjustData.end) {
                adjustEffectiveDate.value = today;
            } else {
                adjustEffectiveDate.value = currentAdjustData.start;
            }
        }

        if (adjustDateLimitHint) {
            adjustDateLimitHint.textContent = `Chọn từ ngày ${currentAdjustData.start} đến ngày ${currentAdjustData.end}`;
        }

        // Dropdown ca mới: disable ca hiện tại để tránh chọn trùng
        if (adjustShiftSelect) {
            Array.from(adjustShiftSelect.options).forEach((opt) => {
                if (!opt.value) return;
                const isCurrent = opt.value === currentAdjustData.currentShiftId;
                opt.disabled = isCurrent;
                if (isCurrent) {
                    opt.textContent = `${opt.dataset.code} - ${opt.dataset.name} (Ca hiện tại)`;
                } else {
                    opt.textContent = `${opt.dataset.code} - ${opt.dataset.name}`;
                }
            });
            adjustShiftSelect.value = '';
        }

        if (adjustNote) {
            adjustNote.value = '';
        }

        clearAdjustError();
        updateAdjustPreview();

        adjustModal.classList.remove('hidden');
        document.body.classList.add('shift-modal-open');
    };

    const closeAdjustModal = () => {
        if (adjustModal) adjustModal.classList.add('hidden');
        document.body.classList.remove('shift-modal-open');
        clearAdjustError();
    };

    document.querySelectorAll('[data-close-adjust-modal]').forEach((btn) => {
        btn.addEventListener('click', closeAdjustModal);
    });

    if (adjustShiftSelect) {
        adjustShiftSelect.addEventListener('change', updateAdjustPreview);
    }
    if (adjustEffectiveDate) {
        adjustEffectiveDate.addEventListener('input', updateAdjustPreview);
    }

    if (adjustForm) {
        adjustForm.addEventListener('submit', (e) => {
            clearAdjustError();
            if (!adjustShiftSelect.value) {
                e.preventDefault();
                showAdjustError('Vui lòng chọn ca làm việc mới.');
                return;
            }
            if (adjustShiftSelect.value === currentAdjustData.currentShiftId) {
                e.preventDefault();
                showAdjustError('Ca mới phải khác ca đang áp dụng.');
                return;
            }
            if (!adjustEffectiveDate.value) {
                e.preventDefault();
                showAdjustError('Vui lòng chọn ngày hiệu lực.');
                return;
            }
            if (adjustEffectiveDate.value < currentAdjustData.start || adjustEffectiveDate.value > currentAdjustData.end) {
                e.preventDefault();
                showAdjustError(`Ngày hiệu lực phải nằm trong khoảng từ ${currentAdjustData.start} đến ${currentAdjustData.end}.`);
                return;
            }
        });
    }

    // Nút điều chỉnh ca trong Cell Detail Modal
    if (cellDetailEditAssignBtn) {
        cellDetailEditAssignBtn.addEventListener('click', () => {
            if (!currentCellData) return;
            closeCellDetailModal();
            openAdjustShiftModal({
                assignmentId: currentCellData.assignmentId,
                empName: currentCellData.empName,
                empCode: currentCellData.empCode,
                empDept: currentCellData.empDept,
                shiftId: currentCellData.shiftId,
                shiftName: currentCellData.shiftName,
                morning: currentCellData.morning,
                afternoon: currentCellData.afternoon,
                start: currentCellData.start,
                end: currentCellData.end,
                note: currentCellData.note,
                preferredEffectiveDate: currentCellData.date
            });
        });
    }

    if (cellDetailViewEmpCalBtn) {
        cellDetailViewEmpCalBtn.addEventListener('click', () => {
            if (!currentCellData) return;
            const empId = currentCellData.empId;
            const empName = currentCellData.empName;
            const empCode = currentCellData.empCode;
            const empDept = currentCellData.empDept;
            closeCellDetailModal();
            openEmployeeCalendarModal({ id: empId, name: empName, code: empCode, dept: empDept });
        });
    }

    // 6. Modal Lịch phân ca tháng cá nhân (Employee Monthly Calendar Modal)
    const empCalModal = document.getElementById('employee-calendar-modal');
    const empCalAvatar = document.getElementById('emp-cal-avatar');
    const empCalName = document.getElementById('emp-cal-name');
    const empCalCode = document.getElementById('emp-cal-code');
    const empCalDept = document.getElementById('emp-cal-dept');
    const empCalPrevMonthBtn = document.getElementById('emp-cal-prev-month');
    const empCalNextMonthBtn = document.getElementById('emp-cal-next-month');
    const empCalMonthTitle = document.getElementById('emp-cal-month-title');
    const empCalPrintBtn = document.getElementById('emp-cal-print-btn');
    const empCalWorkCount = document.getElementById('emp-cal-work-count');
    const empCalRestCount = document.getElementById('emp-cal-rest-count');
    const empCalCurrentShift = document.getElementById('emp-cal-current-shift');
    const empCalMonthGrid = document.getElementById('emp-cal-month-grid');

    let currentEmpCalEmployee = null;
    let currentEmpCalYearMonth = '';

    const openEmployeeCalendarModal = async (emp) => {
        currentEmpCalEmployee = emp;
        if (!empCalModal) return;

        const now = new Date();
        currentEmpCalYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        if (empCalName) empCalName.textContent = emp.name || '';
        if (empCalCode) empCalCode.textContent = emp.code || '';
        if (empCalDept) empCalDept.textContent = emp.dept || 'Chưa phân phòng ban';
        if (empCalAvatar) empCalAvatar.textContent = (emp.name || 'NV').slice(0, 2).toUpperCase();

        empCalModal.classList.remove('hidden');
        document.body.classList.add('shift-modal-open');

        await fetchAndRenderEmployeeCalendar(emp.id, currentEmpCalYearMonth);
    };

    const closeEmployeeCalendarModal = () => {
        if (empCalModal) empCalModal.classList.add('hidden');
        document.body.classList.remove('shift-modal-open');
    };

    document.querySelectorAll('[data-close-emp-cal-modal]').forEach((btn) => {
        btn.addEventListener('click', closeEmployeeCalendarModal);
    });

    const fetchAndRenderEmployeeCalendar = async (employeeId, yearMonth) => {
        if (!empCalMonthGrid) return;
        empCalMonthGrid.innerHTML = `
            <div class="col-span-7 py-16 flex flex-col items-center justify-center text-on-surface-variant gap-2">
                <span class="material-symbols-outlined text-[32px] animate-spin text-primary">sync</span>
                <span class="text-body-sm">Đang tải lịch tháng...</span>
            </div>
        `;

        try {
            const res = await fetch(`/admin/shift-assignments/employee-calendar?employee_id=${employeeId}&month=${yearMonth}`);
            if (!res.ok) throw new Error('Không thể tải lịch nhân viên');

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Dữ liệu không hợp lệ');

            renderEmployeeCalendarView(data);
        } catch (err) {
            console.error('Lỗi tải lịch nhân viên:', err);
            empCalMonthGrid.innerHTML = `
                <div class="col-span-7 py-12 text-center text-error">
                    <span class="material-symbols-outlined text-[32px]">error</span>
                    <p class="mt-1 font-label-md">Không thể tải lịch của nhân viên này.</p>
                </div>
            `;
        }
    };

    const renderEmployeeCalendarView = (data) => {
        const { year, month, days, stats, assignments } = data;

        if (empCalMonthTitle) {
            empCalMonthTitle.textContent = `Tháng ${String(month).padStart(2, '0')}/${year}`;
        }
        if (empCalWorkCount) empCalWorkCount.textContent = `${stats.workingDaysCount} ngày`;
        if (empCalRestCount) empCalRestCount.textContent = `${stats.restDaysCount} ngày`;
        if (empCalCurrentShift) {
            if (assignments && assignments.length > 0) {
                empCalCurrentShift.textContent = assignments.map(a => `${a.shift_name} (${a.shift_code})`).join('; ');
            } else {
                empCalCurrentShift.textContent = 'Chưa có phân ca trong tháng';
            }
        }

        empCalMonthGrid.innerHTML = '';

        // Xác định ngày đầu tiên của tháng là thứ mấy (1 = Thứ 2 .. 7 = CN)
        const firstDayDb = days[0].dayOfWeek;
        // Chèn các ô trống cho các thứ trước ngày mùng 1
        for (let i = 1; i < firstDayDb; i++) {
            const blank = document.createElement('div');
            blank.className = 'min-h-[72px] sm:min-h-[84px] p-1.5 rounded-xl bg-surface-container-low/40 border border-transparent';
            empCalMonthGrid.appendChild(blank);
        }

        // Render từng ngày trong tháng
        days.forEach((day) => {
            const dayEl = document.createElement('div');
            const isWork = day.schedule && day.schedule.type === 'work';
            const isRest = day.schedule && day.schedule.type === 'rest';

            dayEl.className = `min-h-[72px] sm:min-h-[84px] p-2 rounded-xl flex flex-col justify-between border transition-all ${
                day.isToday
                    ? 'ring-2 ring-primary border-primary bg-primary/5 shadow-xs'
                    : (day.isWeekend ? 'bg-surface-container-high/20 border-surface-container-high' : 'bg-surface-container-lowest border-surface-container-high')
            }`;

            // Header ô ngày: số ngày
            const headerHtml = `
                <div class="flex items-center justify-between">
                    <span class="font-data-mono text-[13px] font-bold ${day.isToday ? 'px-1.5 py-0.5 rounded-md bg-primary text-on-primary' : (day.isWeekend ? 'text-amber-700' : 'text-on-surface')}">
                        ${day.dayNumber}
                    </span>
                    ${day.isToday ? '<span class="text-[9px] uppercase font-bold text-primary">Hôm nay</span>' : ''}
                </div>
            `;

            let bodyHtml = '';
            if (isWork) {
                const colors = getShiftColor(day.schedule.shiftCode);
                bodyHtml = `
                    <div class="mt-1 p-1 rounded-lg ${colors.bg} ${colors.text} border ${colors.border} flex flex-col">
                        <span class="font-bold text-[11px] truncate leading-tight">${day.schedule.shiftName}</span>
                        <span class="font-data-mono text-[10px] opacity-80 mt-0.5 truncate">${day.schedule.morningTime || day.schedule.timeFormatted}</span>
                    </div>
                `;
            } else if (isRest) {
                bodyHtml = `
                    <div class="mt-1 p-1 rounded-lg bg-surface-container-high/50 text-on-surface-variant/70 text-[10px] font-medium text-center">
                        Nghỉ ca
                    </div>
                `;
            } else {
                bodyHtml = `
                    <div class="mt-1 text-center text-outline/40 text-[10px]">
                        —
                    </div>
                `;
            }

            dayEl.innerHTML = headerHtml + bodyHtml;
            empCalMonthGrid.appendChild(dayEl);
        });
    };

    if (empCalPrevMonthBtn) {
        empCalPrevMonthBtn.addEventListener('click', () => {
            if (!currentEmpCalYearMonth || !currentEmpCalEmployee) return;
            const [y, m] = currentEmpCalYearMonth.split('-').map(Number);
            const prevDate = new Date(Date.UTC(y, m - 2, 1, 12, 0, 0));
            currentEmpCalYearMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
            fetchAndRenderEmployeeCalendar(currentEmpCalEmployee.id, currentEmpCalYearMonth);
        });
    }

    if (empCalNextMonthBtn) {
        empCalNextMonthBtn.addEventListener('click', () => {
            if (!currentEmpCalYearMonth || !currentEmpCalEmployee) return;
            const [y, m] = currentEmpCalYearMonth.split('-').map(Number);
            const nextDate = new Date(Date.UTC(y, m, 1, 12, 0, 0));
            currentEmpCalYearMonth = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}`;
            fetchAndRenderEmployeeCalendar(currentEmpCalEmployee.id, currentEmpCalYearMonth);
        });
    }

    if (empCalPrintBtn) {
        empCalPrintBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // 7. Ủy quyền sự kiện click trên toàn trang (Event Delegation)
    document.addEventListener('click', (e) => {
        // A. Bấm nút xem lịch nhân viên
        const viewCalBtn = e.target.closest('[data-view-employee-calendar]');
        if (viewCalBtn) {
            const emp = {
                id: viewCalBtn.dataset.id,
                name: viewCalBtn.dataset.name,
                code: viewCalBtn.dataset.code,
                dept: viewCalBtn.dataset.dept
            };
            openEmployeeCalendarModal(emp);
            return;
        }

        // B. Bấm nút "Điều chỉnh ca" trên bảng danh sách
        const adjustBtn = e.target.closest('[data-adjust-shift]');
        if (adjustBtn) {
            openAdjustShiftModal(adjustBtn.dataset);
            return;
        }

        // C. Bấm thẻ ca làm việc trên ma trận lịch
        const workCard = e.target.closest('[data-cell-work]');
        if (workCard) {
            openCellDetailModal(workCard.dataset);
            return;
        }

        // D. Bấm ô trống (+) để phân ca nhanh
        const addCell = e.target.closest('[data-cell-add]');
        if (addCell) {
            const empId = addCell.dataset.empId;
            const date = addCell.dataset.date;
            const openCreateBtn = document.getElementById('open-create-assignment');
            if (openCreateBtn) {
                openCreateBtn.click();
                const empSelect = document.getElementById('assignment_employee');
                const startInput = document.getElementById('assignment_start');
                const endInput = document.getElementById('assignment_end');
                if (empSelect) {
                    empSelect.value = empId;
                    empSelect.dispatchEvent(new Event('change'));
                }
                if (startInput) startInput.value = date;
                if (endInput) endInput.value = date;
            }
            return;
        }
    });

    // 8. Xử lý ESC để đóng modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (adjustModal && !adjustModal.classList.contains('hidden')) {
                closeAdjustModal();
            }
            if (cellDetailModal && !cellDetailModal.classList.contains('hidden')) {
                closeCellDetailModal();
            }
            if (empCalModal && !empCalModal.classList.contains('hidden')) {
                closeEmployeeCalendarModal();
            }
        }
    });

})();
