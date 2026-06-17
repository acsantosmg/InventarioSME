const app = {
    isLoggedIn: false,
    currentUser: null,
    currentInstituicao: null,
    scanner: null,
    auditScanner: null,
    currentItem: null,
    auditSession: {
        pending: [],
        returned: [],
        startTime: null
    },

    init: async () => {
        await db.init();
        await app.users.init();
        app.instituicoes.init();

        // Busca usuários da nuvem silenciosamente ao iniciar
        sync.pullUsersOnInit().catch(() => {});

        const savedSession = localStorage.getItem('sessionData');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                const user = app.users.get(session.username);
                if (user && session.instituicao) {
                    // Garante level válido antes de aplicar permissões
                    if (!['admin', 'editor', 'viewer'].includes(user.level)) {
                        user.level = user.username === 'admin' ? 'admin' : 'viewer';
                        app.users.create(user);
                    }
                    app.isLoggedIn = true;
                    app.currentUser = user;
                    app.currentInstituicao = session.instituicao;
                    document.getElementById('btn-login-toggle').textContent = `🔓 ${user.name}`;
                    app.applyPermissions(app.accessLevels[user.level]);
                }
            } catch (e) {
                localStorage.removeItem('sessionData');
            }
        }

        if (!app.isLoggedIn) {
            app.showLoginScreen();
        } else {
            app.navigate('dashboard');
            app.updateDashboard();
            app.updateInstituicaoDisplay();
            app.updateLogoDisplay();
        }
        
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').then(reg => {
                // Detecta quando uma nova versão do SW está instalada
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'activated') {
                            // Recarrega automaticamente para aplicar a atualização
                            window.location.reload();
                        }
                    });
                });
            }).catch(console.error);

            // Recebe mensagem do SW quando uma nova versão ativa
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data?.type === 'SW_UPDATED') {
                    window.location.reload();
                }
            });
        }
    },

    showLoginScreen: () => {
        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        const loginView = document.getElementById('view-login-required');
        if (loginView) loginView.classList.remove('hidden');
        app.updateLogoDisplay();
    },

    updateLogoDisplay: () => {
        const headerLogo = document.getElementById('header-logo');
        const loginLogo = document.getElementById('login-logo');
        
        if (app.currentInstituicao && app.currentInstituicao.logo) {
            if (headerLogo) {
                headerLogo.src = app.currentInstituicao.logo;
                headerLogo.style.display = 'block';
                headerLogo.classList.remove('hidden');
            }
            if (loginLogo) {
                loginLogo.src = app.currentInstituicao.logo;
                loginLogo.style.display = 'block';
                loginLogo.classList.remove('hidden');
            }
        } else {
            if (headerLogo) {
                headerLogo.style.display = 'none';
                headerLogo.classList.add('hidden');
            }
            if (loginLogo) {
                loginLogo.style.display = 'none';
                loginLogo.classList.add('hidden');
            }
        }
    },

    forceUpdate: () => {
        if (confirm('Isso vai limpar o cache e recarregar.\n\nSeus USUÁRIOS e UNIDADES serão PRESERVADOS.\n\nOK?')) {
            const protectedKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('user_') || key.startsWith('inst_'))) {
                    protectedKeys.push({ key, value: localStorage.getItem(key) });
                }
            }
            localStorage.clear();
            protectedKeys.forEach(({ key, value }) => {
                localStorage.setItem(key, value);
            });
            if ('caches' in window) {
                caches.keys().then(names => names.forEach(n => caches.delete(n)));
            }
            window.location.reload(true);
        }
    },

    navigate: (viewId) => {
        if (!app.isLoggedIn && viewId !== 'login-required') {
            app.showLoginScreen();
            return;
        }

        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        const target = document.getElementById(`view-${viewId}`);
        if (target) {
            target.classList.remove('hidden');
        } else {
            alert('ERRO: View não encontrada: view-' + viewId);
        }
        
        if (viewId === 'dashboard') {
            app.renderList();
            app.updateInstituicaoDisplay();
        }
        if (viewId === 'add') {
            document.getElementById('item-codigo').value = app.generateCode();
        }
        if (viewId === 'scanner') app.startScanner();
        if (viewId === 'audit') app.renderAudit();
        if (viewId === 'reports') app.renderReports();
    },

    generateCode: () => {
        const year = new Date().getFullYear();
        const random = Math.floor(10000 + Math.random() * 90000);
        return `${APP_CONFIG.CODIGO_PREFIXO}-${year}-${random}`;
    },

    updateInstituicaoDisplay: () => {
        const display = document.getElementById('current-instituicao-display');
        if (!display) return;
        if (app.currentInstituicao) {
            display.textContent = `📍 ${app.currentInstituicao.nome} - ${app.currentInstituicao.cidade || ''}`;
            display.classList.remove('hidden');
        } else {
            display.classList.add('hidden');
        }
    },

    toggleLogin: () => {
        if (app.isLoggedIn) {
            if (confirm('Deseja sair do sistema?')) {
                app.isLoggedIn = false;
                app.currentUser = null;
                app.currentInstituicao = null;
                localStorage.removeItem('sessionData');
                const btn = document.getElementById('btn-login-toggle');
                if (btn) btn.textContent = '';
                app.applyPermissions({ canCreate: false, canSync: false, canManageUsers: false });
                app.showLoginScreen();
            }
        } else {
            app.openLoginModal();
        }
    },

    openLoginModal: async () => {
        try {
            await app.users.init();
            app.instituicoes.init();

            const instituicoes = app.instituicoes.getAll();
            const selectInst = document.getElementById('login-instituicao');
            if (selectInst) {
                selectInst.innerHTML = '<option value="">-- Selecione sua unidade --</option>';
                instituicoes.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst.id;
                    option.textContent = `${inst.nome} - ${inst.cidade || ''}`;
                    selectInst.appendChild(option);
                });
            }

            const usuarios = app.users.getAll();
            const selectUser = document.getElementById('login-user-select');
            if (selectUser) {
                selectUser.innerHTML = '<option value="">-- Selecione seu usuário --</option>';
                usuarios.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.username;
                    const levelInfo = app.accessLevels[user.level];
                    option.textContent = `${user.name || user.username}${levelInfo ? ' (' + levelInfo.name + ')' : ''}`;
                    selectUser.appendChild(option);
                });

                // Ao selecionar usuário, preenche instituição automaticamente
                selectUser.onchange = () => {
                    const user = app.users.get(selectUser.value);
                    if (!user) return;
                    if (user.level === 'admin') {
                        // Admin pode escolher qualquer instituição
                        if (selectInst) selectInst.disabled = false;
                    } else if (user.instituicaoId) {
                        // Usuário comum: instituição travada no cadastro
                        if (selectInst) {
                            selectInst.value = user.instituicaoId;
                            selectInst.disabled = true;
                        }
                    }
                };
            }

            const passField = document.getElementById('login-pass');
            if (passField) passField.value = '';
            
            const modal = document.getElementById('login-modal');
            if (modal) modal.classList.remove('hidden');
        } catch (error) {
            alert('Erro ao abrir tela de login: ' + error.message);
        }
    },

    doLogin: async () => {
        const username = document.getElementById('login-user-select').value;
        const p = document.getElementById('login-pass').value;

        if (!username) { alert('Selecione seu usuário'); return; }

        const user = app.users.get(username);
        if (!user) { alert('Senha incorreta!'); return; }

        const pHash = await utils.hashPassword(p);
        if (user.passwordHash !== pHash) { alert('Senha incorreta!'); return; }

        // Admin escolhe instituição pelo select; outros têm instituição definida no cadastro
        let instId;
        if (user.level === 'admin') {
            instId = document.getElementById('login-instituicao').value;
            if (!instId) { alert('Selecione a unidade de acesso'); return; }
        } else {
            instId = user.instituicaoId;
            if (!instId) { alert('Usuário sem instituição definida. Contate o administrador.'); return; }
        }

        const instituicao = app.instituicoes.get(instId);
        if (!instituicao) { alert('Instituição não encontrada. Atualize os dados ou contate o administrador.'); return; }

        // Primeiro acesso: exige troca de senha antes de entrar
        if (user.primeiroAcesso) {
            document.getElementById('login-modal').classList.add('hidden');
            await app.forcarTrocaSenha(user, instituicao);
            return;
        }

        app.concluirLogin(user, instituicao);
    },

    // Fluxo de troca obrigatória de senha (primeiro acesso)
    forcarTrocaSenha: async (user, instituicao) => {
        const novaSenha = prompt(
            `Bem-vindo(a), ${user.name}!\n\n` +
            `Este é seu primeiro acesso. Você precisa criar uma senha pessoal.\n\n` +
            `Nova senha (mínimo 6 caracteres):`
        );
        if (!novaSenha || novaSenha.trim().length < 6) {
            alert('Senha inválida. Mínimo de 6 caracteres. Tente novamente.');
            app.openLoginModal();
            return;
        }
        const confirmar = prompt('Confirme sua nova senha:');
        if (novaSenha !== confirmar) {
            alert('As senhas não conferem. Tente novamente.');
            app.openLoginModal();
            return;
        }
        user.passwordHash = await utils.hashPassword(novaSenha.trim());
        delete user.primeiroAcesso;
        app.users.create(user);

        // Publica senha atualizada na nuvem automaticamente
        sync.publishUsers().catch(() => {});

        alert('✅ Senha definida com sucesso! Bem-vindo(a) ao sistema.');
        app.concluirLogin(user, instituicao);
    },

    // Finaliza o login após autenticação e troca de senha (se necessário)
    concluirLogin: (user, instituicao) => {
        app.isLoggedIn = true;
        app.currentUser = user;
        app.currentInstituicao = instituicao;

        localStorage.setItem('sessionData', JSON.stringify({ username: user.username, instituicao }));

        const btn = document.getElementById('btn-login-toggle');
        if (btn) btn.textContent = `🔓 ${user.name}`;

        document.getElementById('login-modal').classList.add('hidden');

        app.applyPermissions(app.accessLevels[user.level]);
        app.navigate('dashboard');
        app.updateDashboard();
        app.updateInstituicaoDisplay();
        app.updateLogoDisplay();

        const hora = new Date().getHours();
        let saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
        setTimeout(() => {
            alert(`${saudacao}, ${user.name}!\n\nBem-vindo(a) ao sistema de Inventário.\nUnidade: ${instituicao.nome}`);
        }, 300);
    },

    applyPermissions: (perms) => {
        if (!perms) perms = app.accessLevels['viewer']; // fallback seguro
        const addBtn = document.querySelector('button[onclick="app.navigate(\'add\')"]');
        if (addBtn) addBtn.style.display = perms.canCreate ? 'block' : 'none';
        
        const syncBtn = document.querySelector('button[onclick="sync.runSync()"]');
        if (syncBtn) syncBtn.style.display = perms.canSync ? 'block' : 'none';
        
        const userMgmtBtn = document.getElementById('btn-user-management');
        if (userMgmtBtn) userMgmtBtn.style.display = perms.canManageUsers ? 'block' : 'none';

        const instMgmtBtn = document.getElementById('btn-instituicao-management');
        if (instMgmtBtn) instMgmtBtn.style.display = perms.canManageUsers ? 'block' : 'none';

        const printBtn = document.querySelector('button[onclick="app.printLabels()"]');
        if (printBtn) printBtn.style.display = perms.canCreate ? 'block' : 'none';

        const reportsBtn = document.getElementById('btn-reports');
        if (reportsBtn) {
            if (perms.canManageUsers) {
                reportsBtn.classList.remove('hidden');
                reportsBtn.style.display = 'block';
            } else {
                reportsBtn.classList.add('hidden');
                reportsBtn.style.display = 'none';
            }
        }

        const auditBtn = document.getElementById('btn-audit');
        if (auditBtn) {
            if (perms.canCreate) {
                auditBtn.classList.remove('hidden');
                auditBtn.style.display = 'block';
            } else {
                auditBtn.classList.add('hidden');
                auditBtn.style.display = 'none';
            }
        }
    },

    saveItem: async (e) => {
        e.preventDefault();
        if (!app.isLoggedIn || !app.currentInstituicao) {
            alert('Faça login e selecione uma unidade');
            return;
        }
        
        const fileInput = document.getElementById('item-foto');
        let fotoBase64 = '';
        if (fileInput.files[0]) {
            fotoBase64 = await utils.compressImage(fileInput.files[0]);
        } else {
            if (!confirm('Você não adicionou uma foto. Deseja continuar mesmo assim?')) return;
        }

        const item = {
            codigo: document.getElementById('item-codigo').value,
            patrimonio: document.getElementById('item-patrimonio').value.trim(),
            categoria: document.getElementById('item-categoria').value,
            descricao: document.getElementById('item-descricao').value,
            foto: fotoBase64,
            observacao: document.getElementById('item-obs').value.trim(),
            status: 'Ativo',
            dataEntrada: new Date().toISOString().split('T')[0],
            historico: [`Criado em ${new Date().toLocaleString()} por ${app.currentUser.name}`],
            instituicao: app.currentInstituicao.id,
            instituicaoNome: app.currentInstituicao.nome,
            instituicaoCidade: app.currentInstituicao.cidade
        };

        await db.save(item);
        alert('Item salvo!');
        document.getElementById('form-add').reset();
        app.navigate('dashboard');
        app.updateDashboard();
    },

    renderList: async () => {
        const items = await db.getAll(app.currentInstituicao?.id);
        const container = document.getElementById('items-list');
        if (!container) return;
        container.innerHTML = '';
        
        const filter = document.getElementById('search-input').value.toLowerCase();
        const filtered = items.filter(i => 
            i.codigo.toLowerCase().includes(filter) || 
            i.descricao.toLowerCase().includes(filter) ||
            (i.patrimonio && i.patrimonio.toLowerCase().includes(filter))
        );

        if (filtered.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 py-8">Nenhum item cadastrado nesta unidade</p>';
            return;
        }

        filtered.forEach(item => {
            const temObs = item.observacao && item.observacao.trim() !== '';
            const patrimonioBadge = item.patrimonio ? `<p class="text-xs text-blue-600 font-mono">Pat: ${item.patrimonio}</p>` : '';
            const div = document.createElement('div');
            div.className = 'bg-white p-3 rounded shadow border-l-4 ' + (item.status === 'Ativo' ? 'border-green-500' : 'border-red-500');
            div.innerHTML = `
                <div class="flex justify-between items-center cursor-pointer" onclick="app.renderDetail('${item.codigo}')">
                    <div>
                        <p class="font-bold text-sm">${item.codigo} ${temObs ? '📝' : ''}</p>
                        <p class="text-xs text-gray-600">${item.descricao}</p>
                        ${patrimonioBadge}
                    </div>
                    <span class="text-xs px-2 py-1 rounded bg-gray-200">${item.status}</span>
                </div>
            `;
            container.appendChild(div);
        });
    },

    filterItems: () => { app.renderList(); },

    renderDetail: async (codigo) => {
        const item = await db.get(codigo);
        if (!item) { alert('Item não encontrado'); app.navigate('dashboard'); return; }
        
        app.currentItem = item;
        const container = document.getElementById('detail-content');
        if (!container) return;
        
        let historicoHtml = item.historico.map(h => `<li class="text-xs text-gray-600">• ${h}</li>`).join('');
        const obsText = (item.observacao && item.observacao.trim() !== '') ? item.observacao : 'Nenhuma observação registrada.';
        const patrimonioDisplay = item.patrimonio ? `<p class="text-sm font-mono bg-blue-50 px-2 py-1 rounded inline-block mt-1">🏷️ Nº Patrimônio: <strong>${item.patrimonio}</strong></p>` : '';

        let fotoUrl = item.foto || '';
        if (fotoUrl.includes('lh3.googleusercontent.com/d/')) {
            const fileId = fotoUrl.match(/\/d\/([^\/\?]+)/)?.[1];
            if (fileId) fotoUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
        }

        const fotoHtml = fotoUrl ? `<img src="${fotoUrl}" class="w-full h-48 object-cover rounded-lg mb-4" onerror="this.style.display='none'">` : '';

        container.innerHTML = `
            ${fotoHtml}
            <h2 class="text-2xl font-bold">${item.codigo}</h2>
            ${patrimonioDisplay}
            <p class="text-gray-600">${item.categoria} | ${item.descricao}</p>
            <p class="text-xs text-blue-600 font-bold">📍 ${item.instituicaoNome || 'Unidade não identificada'} ${item.instituicaoCidade ? '- ' + item.instituicaoCidade : ''}</p>
            <div class="bg-gray-100 p-3 rounded mt-2">
                <p><strong>Status:</strong> ${item.status}</p>
                <p><strong>Responsável:</strong> ${item.responsavel || 'N/A'}</p>
            </div>
            <div class="bg-yellow-50 p-3 rounded mt-2 border border-yellow-200">
                <div class="flex justify-between items-center mb-1">
                    <p class="font-bold text-sm text-yellow-800"> Observações:</p>
                    <button id="btn-edit-obs" onclick="app.editObservation()" class="hidden text-xs bg-yellow-600 text-white px-3 py-1 rounded shadow">Editar</button>
                </div>
                <p id="detail-obs-text" class="text-sm text-gray-700 whitespace-pre-wrap">${obsText}</p>
            </div>
            <div class="mt-4 bg-white p-4 rounded-lg shadow text-center border">
                <p class="text-sm font-bold mb-2">QR Code</p>
                <div id="detail-qrcode" class="flex justify-center mb-2"></div>
                <p class="text-xs font-mono text-gray-600 break-all">${item.codigo}</p>
                <p class="text-xs text-gray-500 mt-1">${item.descricao}</p>
            </div>
            <div class="mt-4">
                <h4 class="font-bold text-sm mb-2">Histórico</h4>
                <ul class="space-y-1">${historicoHtml}</ul>
            </div>
        `;

        setTimeout(() => {
            const qrContainer = document.getElementById("detail-qrcode");
            if (qrContainer) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, { text: item.codigo, width: 150, height: 150 });
            }
        }, 100);

        const btnEditObs = document.getElementById('btn-edit-obs');
        if (app.isLoggedIn && app.currentUser && app.currentUser.level === 'admin') {
            btnEditObs.classList.remove('hidden');
        } else {
            btnEditObs.classList.add('hidden');
        }

        const adminActions = document.getElementById('admin-actions');
        if (adminActions) {
            if (app.isLoggedIn) adminActions.classList.remove('hidden');
            else adminActions.classList.add('hidden');
        }
        app.navigate('detail');
    },

    editObservation: async () => {
        if (!app.isLoggedIn || !app.currentUser || app.currentUser.level !== 'admin') {
            alert('Apenas administradores podem editar observações.'); return;
        }
        const currentObs = app.currentItem.observacao || '';
        const newObs = prompt('Editar observação (deixe vazio para apagar):', currentObs);
        if (newObs !== null) {
            app.currentItem.observacao = newObs.trim();
            const acao = newObs.trim() !== '' ? 'Observação atualizada' : 'Observação limpa';
            app.currentItem.historico.push(`${acao} em ${new Date().toLocaleString()} por ${app.currentUser.name}.`);
            await db.save(app.currentItem);
            app.renderDetail(app.currentItem.codigo);
            app.renderList();
        }
    },

    updateStatus: async (newStatus) => {
        if (!app.isLoggedIn) return;
        let responsavel = app.currentUser.name || app.currentUser.username;
        let obs = '';
        if (newStatus === 'Emprestado') {
            responsavel = prompt('Nome do responsável:') || responsavel;
            obs = prompt('Previsão de devolução:') || '-';
        } else if (newStatus === 'Manutenção') {
            obs = prompt('Motivo / Nº OS:') || '-';
        }
        app.currentItem.status = newStatus;
        app.currentItem.responsavel = responsavel;
        app.currentItem.historico.push(`${newStatus} em ${new Date().toLocaleString()} por ${responsavel}. Obs: ${obs}`);
        await db.save(app.currentItem);
        alert(`Status: ${newStatus}`);
        app.renderDetail(app.currentItem.codigo);
        app.updateDashboard();
    },

    baixarItem: async () => {
        if (!app.isLoggedIn) return;
        const motivo = prompt('Motivo da baixa:');
        if (!motivo) return;
        app.currentItem.status = 'Baixado';
        app.currentItem.historico.push(`BAIXA em ${new Date().toLocaleString()} por ${app.currentUser.name}. Motivo: ${motivo}`);
        await db.save(app.currentItem);
        alert('Baixado.');
        app.navigate('dashboard');
        app.updateDashboard();
    },

    editItem: async () => {
        if (!app.isLoggedIn || !app.currentUser) { alert('Faça login para editar'); return; }
        const item = app.currentItem;
        document.getElementById('edit-codigo').value = item.codigo;
        document.getElementById('edit-patrimonio').value = item.patrimonio || '';
        document.getElementById('edit-categoria').value = item.categoria;
        document.getElementById('edit-descricao').value = item.descricao;
        document.getElementById('edit-obs').value = item.observacao || '';
        const preview = document.getElementById('edit-foto-preview');
        if (item.foto) { preview.src = item.foto; preview.style.display = 'block'; }
        else { preview.style.display = 'none'; }
        document.getElementById('edit-item-modal').classList.remove('hidden');
    },

    saveEditItem: async () => {
        if (!app.isLoggedIn || !app.currentUser) return;
        const fileInput = document.getElementById('edit-foto');
        let fotoBase64 = app.currentItem.foto;
        if (fileInput.files[0]) {
            fotoBase64 = await utils.compressImage(fileInput.files[0]);
            app.currentItem.historico.push(`Foto atualizada em ${new Date().toLocaleString()} por ${app.currentUser.name}`);
        }
        const novoPatrimonio = document.getElementById('edit-patrimonio').value.trim();
        if (novoPatrimonio !== (app.currentItem.patrimonio || '')) {
            app.currentItem.historico.push(`Nº Patrimônio alterado para "${novoPatrimonio || 'vazio'}" em ${new Date().toLocaleString()} por ${app.currentUser.name}`);
        }
        app.currentItem.patrimonio = novoPatrimonio;
        app.currentItem.categoria = document.getElementById('edit-categoria').value;
        app.currentItem.descricao = document.getElementById('edit-descricao').value;
        app.currentItem.observacao = document.getElementById('edit-obs').value.trim();
        app.currentItem.foto = fotoBase64;
        app.currentItem.historico.push(`Editado em ${new Date().toLocaleString()} por ${app.currentUser.name}`);
        await db.save(app.currentItem);
        alert('Item atualizado!');
        document.getElementById('edit-item-modal').classList.add('hidden');
        app.renderDetail(app.currentItem.codigo);
        app.renderList();
    },

    cancelEditItem: () => { document.getElementById('edit-item-modal').classList.add('hidden'); },

    deleteItem: async () => {
        if (!app.isLoggedIn || !app.currentUser || app.currentUser.level !== 'admin') {
            alert('Apenas administradores podem excluir itens'); return;
        }
        const item = app.currentItem;
        if (!confirm(`ATENÇÃO! Excluir permanentemente o item ${item.codigo}?\n\n${item.descricao}\n\nEsta ação NÃO pode ser desfeita!`)) return;
        if (!confirm('TEM CERTEZA ABSOLUTA? O item será removido do banco local.')) return;
        await localforage.removeItem(item.codigo);
        alert('Item excluído com sucesso.');
        app.navigate('dashboard');
        app.updateDashboard();
    },

    updateDashboard: async () => {
        const items = await db.getAll(app.currentInstituicao?.id);
        const dashTotal = document.getElementById('dash-total');
        const dashEmp = document.getElementById('dash-emprestados');
        const dashMan = document.getElementById('dash-manutencao');
        const dashAti = document.getElementById('dash-ativos');
        if (dashTotal) dashTotal.textContent = items.length;
        if (dashEmp) dashEmp.textContent = items.filter(i => i.status === 'Emprestado').length;
        if (dashMan) dashMan.textContent = items.filter(i => i.status === 'Manutenção').length;
        if (dashAti) dashAti.textContent = items.filter(i => i.status === 'Ativo').length;
    },

    printLabels: async () => {
        const items = await db.getAll(app.currentInstituicao?.id);
        if (items.length === 0) { alert('Nenhum item cadastrado nesta unidade.'); return; }
        const printWindow = window.open('', '_blank');
        let labelsHtml = '';
        items.forEach(item => {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(item.codigo)}`;
            const patrimonioLine = item.patrimonio ? `<div class="label-pat">Pat: ${item.patrimonio}</div>` : '';
            labelsHtml += `<div class="label"><img src="${qrUrl}" alt="QR Code" class="qr-img"><div class="label-text"><div class="label-code">${item.codigo}</div><div class="label-desc">${item.descricao}</div>${patrimonioLine}<div class="label-inst">${item.instituicaoNome || ''}</div></div></div>`;
        });
        printWindow.document.write(`<html><head><title>Etiquetas - ${app.currentInstituicao?.nome || ''}</title><style>body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }.container { display: flex; flex-wrap: wrap; gap: 15px; }.label { border: 1px dashed #ccc; padding: 10px; width: 180px; text-align: center; page-break-inside: avoid; display: flex; flex-direction: column; align-items: center; }.qr-img { width: 120px; height: 120px; margin-bottom: 8px; }.label-code { font-weight: bold; font-size: 12px; margin-bottom: 4px; }.label-desc { font-size: 10px; color: #555; word-wrap: break-word; }.label-pat { font-size: 9px; color: #1e40af; font-weight: bold; margin-top: 2px; }.label-inst { font-size: 9px; color: #888; margin-top: 4px; font-style: italic; }@media print { body { padding: 0; } .label { border: 1px solid #000; } .no-print { display: none; } }</style></head><body><div class="no-print" style="text-align:center; margin-bottom:20px;"><h2>Etiquetas - ${app.currentInstituicao?.nome || ''} (${items.length} itens)</h2><button onclick="window.print()" style="padding:10px 20px; font-size:16px; cursor:pointer;">️ Imprimir Agora</button></div><div class="container">${labelsHtml}</div></body></html>`);
        printWindow.document.close();
    },

    startScanner: () => {
        app.scanner = new Html5Qrcode("reader");
        app.scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } },
            async (decodedText) => {
                app.stopScanner();
                if (!app.isLoggedIn) { alert(`Código: ${decodedText}\n(Faça login para ver detalhes)`); app.navigate('dashboard'); }
                else {
                    const item = await db.get(decodedText);
                    if (item) app.renderDetail(decodedText);
                    else { alert('Item não encontrado.'); app.navigate('dashboard'); }
                }
            }, () => { }).catch(err => { alert('Erro na câmera.'); app.navigate('dashboard'); });
    },

    stopScanner: () => { if (app.scanner) { app.scanner.stop().catch(() => {}); app.scanner = null; } },

    exportCSV: async () => { utils.exportCSV(await db.getAll(app.currentInstituicao?.id)); },
    exportPDF: async () => { utils.exportPDF(await db.getAll(app.currentInstituicao?.id)); },

    clearData: async () => {
        const items = await db.getAll();
        if (items.length > 0) {
            const confirmMsg = `ATENÇÃO! Você tem ${items.length} itens cadastrados localmente.\n\nAntes de limpar, deseja fazer backup na nuvem?\n\nOK = Fazer backup e depois limpar\nCancelar = Abortar operação`;
            if (confirm(confirmMsg)) {
                try { await sync.runSync(); alert('Backup concluído! Agora os dados serão limpos.'); }
                catch (error) { if (!confirm('Erro no backup. Deseja limpar mesmo assim?')) return; }
            } else { return; }
        }
        if (confirm('TEM CERTEZA ABSOLUTA? Isso apagará TODOS OS ITENS do celular.\n\nUSUÁRIOS E UNIDADES SERÃO PRESERVADOS.')) {
            await db.clear();
            const protectedKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('user_') || key.startsWith('inst_'))) {
                    protectedKeys.push({ key, value: localStorage.getItem(key) });
                }
            }
            localStorage.clear();
            protectedKeys.forEach(({ key, value }) => {
                localStorage.setItem(key, value);
            });
            window.location.reload();
        }
    },

    startAudit: async () => {
        if (!app.isLoggedIn) {
            alert('Faça login para iniciar conferência');
            app.navigate('dashboard');
            return;
        }

        if (!app.currentInstituicao) {
            alert('Selecione uma instituição primeiro');
            app.navigate('dashboard');
            return;
        }

        try {
            const allItems = await db.getAll(app.currentInstituicao.id);
            const emprestados = allItems.filter(i => i.status === 'Emprestado');

            if (emprestados.length === 0) {
                const continuar = confirm('Não há itens emprestados no momento.\n\nDeseja iniciar uma conferência mesmo assim?');
                if (!continuar) {
                    app.navigate('dashboard');
                    return;
                }
            }

            app.auditSession = {
                pending: emprestados.map(i => ({
                    codigo: i.codigo,
                    patrimonio: i.patrimonio,
                    descricao: i.descricao,
                    responsavel: i.responsavel,
                    categoria: i.categoria
                })),
                returned: [],
                startTime: new Date().toISOString()
            };

            app.navigate('audit');
        } catch (error) {
            alert('Erro ao iniciar conferência: ' + error.message);
        }
    },

    renderAudit: () => {
        try {
            const pendentesEl = document.getElementById('audit-pendentes');
            const devolvidosEl = document.getElementById('audit-devolvidos');
            const totalEl = document.getElementById('audit-total');
            
            if (pendentesEl) pendentesEl.textContent = app.auditSession.pending.length;
            if (devolvidosEl) devolvidosEl.textContent = app.auditSession.returned.length;
            if (totalEl) totalEl.textContent = app.auditSession.pending.length + app.auditSession.returned.length;

            const pendingContainer = document.getElementById('audit-pending-list');
            if (pendingContainer) {
                if (app.auditSession.pending.length === 0) {
                    pendingContainer.innerHTML = '<p class="text-center text-green-600 py-4">✅ Todos os itens foram devolvidos!</p>';
                } else {
                    pendingContainer.innerHTML = app.auditSession.pending.map(item => `
                        <div class="bg-yellow-50 p-2 rounded border-l-4 border-yellow-500">
                            <p class="font-bold text-sm">${item.codigo} ${item.patrimonio ? '<span class="text-xs text-blue-600">(Pat: ' + item.patrimonio + ')</span>' : ''}</p>
                            <p class="text-xs text-gray-600">${item.descricao}</p>
                            <p class="text-xs text-gray-500">Responsável: ${item.responsavel || 'N/A'}</p>
                        </div>
                    `).join('');
                }
            }

            const returnedContainer = document.getElementById('audit-returned-list');
            if (returnedContainer) {
                if (app.auditSession.returned.length === 0) {
                    returnedContainer.innerHTML = '<p class="text-center text-gray-500 py-4">Nenhum item devolvido ainda</p>';
                } else {
                    returnedContainer.innerHTML = app.auditSession.returned.map(item => `
                        <div class="bg-green-50 p-2 rounded border-l-4 border-green-500">
                            <p class="font-bold text-sm">${item.codigo} ${item.patrimonio ? '<span class="text-xs text-blue-600">(Pat: ' + item.patrimonio + ')</span>' : ''}</p>
                            <p class="text-xs text-gray-600">${item.descricao}</p>
                            <p class="text-xs text-green-600">Devolvido em: ${item.returnedAt}</p>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            alert('Erro ao renderizar auditoria: ' + error.message);
        }
    },

    startAuditScanner: () => {
        try {
            const container = document.getElementById('audit-reader-container');
            if (container) container.classList.remove('hidden');

            app.auditScanner = new Html5Qrcode("audit-reader");
            app.auditScanner.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                async (decodedText) => {
                    await app.processAuditScan(decodedText);
                },
                () => { }
            ).catch(err => {
                alert('Erro ao iniciar câmera: ' + err);
                app.stopAuditScanner();
            });
        } catch (error) {
            alert('Erro ao iniciar scanner: ' + error.message);
        }
    },

    stopAuditScanner: () => {
        if (app.auditScanner) {
            app.auditScanner.stop().catch(() => {});
            app.auditScanner = null;
        }
        const container = document.getElementById('audit-reader-container');
        if (container) container.classList.add('hidden');
    },

    processAuditScan: async (codigo) => {
        try {
            const item = await db.get(codigo);
            
            if (!item) {
                alert(`❌ Item ${codigo} não encontrado.`);
                return;
            }

            const pendingIndex = app.auditSession.pending.findIndex(p => p.codigo === codigo);
            
            if (pendingIndex === -1) {
                const alreadyReturned = app.auditSession.returned.find(r => r.codigo === codigo);
                if (alreadyReturned) {
                    alert(`⚠️ Item ${codigo} já foi devolvido nesta sessão.`);
                } else {
                    alert(`⚠️ Item ${codigo} não está na lista de pendentes.`);
                }
                return;
            }

            const itemInfo = app.auditSession.pending[pendingIndex];
            if (!confirm(`✅ Confirmar devolução?\n\n${itemInfo.codigo}\n${itemInfo.descricao}${itemInfo.patrimonio ? '\nPatrimônio: ' + itemInfo.patrimonio : ''}\nResponsável: ${itemInfo.responsavel || 'N/A'}`)) {
                return;
            }

            const dataDevolucao = new Date().toLocaleString('pt-BR');
            
            item.status = 'Ativo';
            item.historico.push(`Devolvido em ${dataDevolucao} por ${app.currentUser.name} (Conferência)`);
            item.responsavel = null;
            
            await db.save(item);

            app.auditSession.pending.splice(pendingIndex, 1);
            app.auditSession.returned.push({
                codigo: itemInfo.codigo,
                patrimonio: itemInfo.patrimonio,
                descricao: itemInfo.descricao,
                responsavel: itemInfo.responsavel,
                categoria: itemInfo.categoria,
                returnedAt: dataDevolucao
            });

            if (navigator.vibrate) navigator.vibrate(200);

            alert(`✅ Item devolvido!\n\n${itemInfo.codigo}\n${itemInfo.descricao}`);

            app.renderAudit();
            app.updateDashboard();

            if (app.auditSession.pending.length === 0) {
                setTimeout(() => {
                    alert('🎉 Todos os itens foram devolvidos!');
                }, 500);
            }
        } catch (error) {
            alert('Erro ao processar scan: ' + error.message);
        }
    },

    generateAuditReport: async () => {
        try {
            if (app.auditSession.returned.length === 0 && app.auditSession.pending.length === 0) {
                alert('Nenhuma conferência em andamento.');
                return;
            }

            const format = prompt('Escolha o formato:\n\n1 - PDF\n2 - XLSX\n3 - CSV', '1');
            if (!['1', '2', '3'].includes(format)) {
                alert('Formato inválido.');
                return;
            }

            const dataGeracao = new Date().toLocaleString('pt-BR');
            let data = [];

            app.auditSession.returned.forEach(item => {
                data.push({
                    'Código': item.codigo,
                    'Nº Patrimônio': item.patrimonio || '-',
                    'Descrição': item.descricao,
                    'Categoria': item.categoria,
                    'Responsável Original': item.responsavel || '-',
                    'Status': 'Devolvido',
                    'Data/Hora Devolução': item.returnedAt,
                    'Conferido por': app.currentUser.name
                });
            });

            app.auditSession.pending.forEach(item => {
                data.push({
                    'Código': item.codigo,
                    'Nº Patrimônio': item.patrimonio || '-',
                    'Descrição': item.descricao,
                    'Categoria': item.categoria,
                    'Responsável Original': item.responsavel || '-',
                    'Status': 'PENDENTE',
                    'Data/Hora Devolução': '-',
                    'Conferido por': app.currentUser.name
                });
            });

            if (data.length === 0) {
                alert('Nenhum dado para gerar relatório.');
                return;
            }

            const nomeArquivo = `Conferencia_${new Date().toISOString().split('T')[0]}`;

            if (format === '3') utils.exportCSVReport(data, nomeArquivo);
            else if (format === '2') utils.exportXLSX(data, nomeArquivo, 'Conferência', app.currentInstituicao?.nome || '', dataGeracao, app.currentUser.name, app.currentInstituicao?.logo);
            else if (format === '1') utils.exportPDFReport(data, nomeArquivo, 'Conferência', app.currentInstituicao?.nome || '', dataGeracao, app.currentUser.name, app.currentInstituicao?.logo);

            alert(`✅ Relatório gerado!\nDevolvidos: ${app.auditSession.returned.length}\nPendentes: ${app.auditSession.pending.length}`);
        } catch (error) {
            alert('Erro ao gerar relatório: ' + error.message);
        }
    },

    resetAudit: () => {
        if (!confirm('Iniciar nova conferência?')) return;
        app.startAudit();
    },

    stopAudit: () => {
        app.stopAuditScanner();
    },

    renderReports: () => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') {
            alert('Apenas administradores podem acessar relatórios');
            app.navigate('dashboard');
            return;
        }

        const reports = [
            { id: 'completo', icon: '📋', title: 'Inventário Completo', description: 'Lista todos os itens', color: 'blue' },
            { id: 'emprestados', icon: '📤', title: 'Itens Emprestados', description: 'Itens emprestados', color: 'yellow' },
            { id: 'manutencao', icon: '', title: 'Itens em Manutenção', description: 'Status manutenção', color: 'orange' },
            { id: 'baixados', icon: '🗑️', title: 'Itens Baixados', description: 'Itens retirados', color: 'red' },
            { id: 'observacoes', icon: '📝', title: 'Itens com Observações', description: 'Observações pendentes', color: 'amber' },
            { id: 'categorias', icon: '📊', title: 'Resumo por Categoria', description: 'Quantitativo por categoria', color: 'purple' },
            { id: 'historico', icon: '📜', title: 'Histórico', description: 'Log de alterações', color: 'indigo' }
        ];

        const container = document.getElementById('reports-list');
        if (!container) return;
        container.innerHTML = '';

        reports.forEach(report => {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-lg shadow border-l-4 border-' + report.color + '-500';
            card.innerHTML = `
                <div class="flex items-start gap-3 mb-3">
                    <div class="text-3xl">${report.icon}</div>
                    <div class="flex-1">
                        <h3 class="font-bold text-gray-800">${report.title}</h3>
                        <p class="text-xs text-gray-600 mt-1">${report.description}</p>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="app.generateReport('${report.id}', 'pdf')" class="flex-1 bg-red-600 text-white text-xs py-2 rounded font-bold">📄 PDF</button>
                    <button onclick="app.generateReport('${report.id}', 'xlsx')" class="flex-1 bg-green-600 text-white text-xs py-2 rounded font-bold">📊 XLSX</button>
                    <button onclick="app.generateReport('${report.id}', 'csv')" class="flex-1 bg-blue-600 text-white text-xs py-2 rounded font-bold">📝 CSV</button>
                </div>
            `;
            container.appendChild(card);
        });
    },

    generateReport: async (reportId, format) => {
        const items = await db.getAll(app.currentInstituicao?.id);
        const instNome = app.currentInstituicao?.nome || 'Inventário';
        const dataGeracao = new Date().toLocaleString('pt-BR');
        const usuario = app.currentUser?.name || 'Sistema';
        const logo = app.currentInstituicao?.logo || null;

        let data = [];
        let titulo = '';

        switch (reportId) {
            case 'completo':
                titulo = 'Inventário Completo';
                data = items.map(i => ({ 
                    'Código': i.codigo, 
                    'Nº Patrimônio': i.patrimonio || '-',
                    'Categoria': i.categoria, 
                    'Descrição': i.descricao, 
                    'Status': i.status, 
                    'Responsável': i.responsavel || '-', 
                    'Data Entrada': i.dataEntrada || '-', 
                    'Observações': i.observacao || '-' 
                }));
                break;
            case 'emprestados':
                titulo = 'Itens Emprestados';
                data = items.filter(i => i.status === 'Emprestado').map(i => ({ 
                    'Código': i.codigo, 
                    'Nº Patrimônio': i.patrimonio || '-',
                    'Categoria': i.categoria, 
                    'Descrição': i.descricao, 
                    'Responsável': i.responsavel || '-', 
                    'Data Entrada': i.dataEntrada || '-' 
                }));
                if (data.length === 0) { alert('Nenhum item emprestado.'); return; }
                break;
            case 'manutencao':
                titulo = 'Itens em Manutenção';
                data = items.filter(i => i.status === 'Manutenção').map(i => ({ 
                    'Código': i.codigo, 
                    'Nº Patrimônio': i.patrimonio || '-',
                    'Categoria': i.categoria, 
                    'Descrição': i.descricao, 
                    'Responsável': i.responsavel || '-' 
                }));
                if (data.length === 0) { alert('Nenhum item em manutenção.'); return; }
                break;
            case 'baixados':
                titulo = 'Itens Baixados';
                data = items.filter(i => i.status === 'Baixado').map(i => ({ 
                    'Código': i.codigo, 
                    'Nº Patrimônio': i.patrimonio || '-',
                    'Categoria': i.categoria, 
                    'Descrição': i.descricao 
                }));
                if (data.length === 0) { alert('Nenhum item baixado.'); return; }
                break;
            case 'observacoes':
                titulo = 'Itens com Observações';
                data = items.filter(i => i.observacao && i.observacao.trim() !== '').map(i => ({ 
                    'Código': i.codigo, 
                    'Nº Patrimônio': i.patrimonio || '-',
                    'Descrição': i.descricao, 
                    'Observação': i.observacao 
                }));
                if (data.length === 0) { alert('Nenhum item com observações.'); return; }
                break;
            case 'categorias':
                titulo = 'Resumo por Categoria';
                const categorias = {};
                items.forEach(i => {
                    const cat = i.categoria || 'Outro';
                    if (!categorias[cat]) categorias[cat] = { total: 0, ativos: 0, emprestados: 0, manutencao: 0, baixados: 0 };
                    categorias[cat].total++;
                    if (i.status === 'Ativo') categorias[cat].ativos++;
                    else if (i.status === 'Emprestado') categorias[cat].emprestados++;
                    else if (i.status === 'Manutenção') categorias[cat].manutencao++;
                    else if (i.status === 'Baixado') categorias[cat].baixados++;
                });
                data = Object.keys(categorias).map(cat => ({ 
                    'Categoria': cat, 
                    'Total': categorias[cat].total, 
                    'Ativos': categorias[cat].ativos, 
                    'Emprestados': categorias[cat].emprestados, 
                    'Em Manutenção': categorias[cat].manutencao, 
                    'Baixados': categorias[cat].baixados 
                }));
                break;
            case 'historico':
                titulo = 'Histórico de Movimentações';
                items.forEach(i => {
                    if (i.historico && Array.isArray(i.historico)) {
                        i.historico.forEach(h => data.push({ 
                            'Código': i.codigo, 
                            'Nº Patrimônio': i.patrimonio || '-',
                            'Descrição': i.descricao, 
                            'Evento': h 
                        }));
                    }
                });
                if (data.length === 0) { alert('Nenhum histórico.'); return; }
                break;
        }

        if (data.length === 0) { alert('Nenhum dado para este relatório.'); return; }

        const nomeArquivo = `${titulo.replace(/\s+/g, '_')}_${app.currentInstituicao?.nome || 'inventário'}_${new Date().toISOString().split('T')[0]}`;

        if (format === 'csv') utils.exportCSVReport(data, nomeArquivo);
        else if (format === 'xlsx') utils.exportXLSX(data, nomeArquivo, titulo, instNome, dataGeracao, usuario, logo);
        else if (format === 'pdf') utils.exportPDFReport(data, nomeArquivo, titulo, instNome, dataGeracao, usuario, logo);

        alert(`✅ Relatório "${titulo}" gerado!\n\n${data.length} registros em ${format.toUpperCase()}`);
    },

    openUserManagement: async () => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') { alert('Apenas administradores'); return; }
        await app.users.init();

        // Popula select de instituição do formulário de criação
        const selectInst = document.getElementById('new-user-instituicao');
        if (selectInst) {
            selectInst.innerHTML = '<option value="">-- Instituição do usuário --</option>';
            app.instituicoes.getAll().forEach(inst => {
                const opt = document.createElement('option');
                opt.value = inst.id;
                opt.textContent = inst.nome;
                selectInst.appendChild(opt);
            });
        }
        const users = app.users.getAll();
        const container = document.getElementById('users-list');
        if (!container) return;
        container.innerHTML = '';
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center p-2 bg-gray-100 rounded';
            div.innerHTML = `
                <div class="flex-1">
                    <p class="font-bold">${user.name}</p>
                    <p class="text-xs text-gray-600">@${user.username} - ${app.accessLevels[user.level].name}</p>
                </div>
                <div class="flex gap-2">
                    ${user.username !== 'admin' ? `<button onclick="app.editUser('${user.username}')" class="text-blue-600 text-xs">Editar</button><button onclick="app.deleteUser('${user.username}')" class="text-red-600 text-xs">Excluir</button>` : '<span class="text-xs text-gray-500">Principal</span>'}
                </div>
            `;
            container.appendChild(div);
        });
        document.getElementById('user-management-modal').classList.remove('hidden');
    },

    closeUserManagement: () => { document.getElementById('user-management-modal').classList.add('hidden'); },

    createUser: async () => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') { alert('Apenas administradores'); return; }
        const name = document.getElementById('new-user-name').value.trim();
        const username = document.getElementById('new-user-username').value.trim();
        const instId = document.getElementById('new-user-instituicao').value;
        const level = document.getElementById('new-user-level').value;
        if (!name || !username) { alert('Preencha nome e usuário'); return; }
        if (!instId) { alert('Selecione a instituição do usuário'); return; }
        if (username.includes(' ')) { alert('Usuário não pode ter espaços'); return; }
        if (app.users.get(username)) { alert('Usuário já existe'); return; }

        const senhaDef = prompt(`Defina a senha inicial para ${name}:\n(mínimo 6 caracteres)`);
        if (!senhaDef || senhaDef.trim().length < 6) { alert('Senha inválida. Mínimo 6 caracteres.'); return; }

        const inst = app.instituicoes.get(instId);
        const passwordHash = await utils.hashPassword(senhaDef.trim());
        app.users.create({ name, username, passwordHash, level, instituicaoId: instId, instituicaoNome: inst?.nome || '', primeiroAcesso: true });
        alert(`Usuário criado!\n\nNome: ${name}\nUsuário: ${username}\nInstituição: ${inst?.nome || instId}\nNível: ${app.accessLevels[level].name}\n\n⚠️ O usuário deverá trocar a senha no primeiro acesso.`);
        document.getElementById('new-user-name').value = '';
        document.getElementById('new-user-username').value = '';
        document.getElementById('new-user-instituicao').value = '';
        app.openUserManagement();
    },

    editUser: async (username) => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') return;
        const user = app.users.get(username);
        if (!user) return;
        const newLevel = prompt(`Alterar nível de ${user.name}?\n\nAtual: ${app.accessLevels[user.level].name}\n\nDigite: admin, editor ou viewer`, user.level);
        if (newLevel && ['admin', 'editor', 'viewer'].includes(newLevel)) {
            user.level = newLevel;
            app.users.create(user);
            alert(`Nível alterado para: ${app.accessLevels[newLevel].name}`);
        }
        if (confirm('Deseja alterar a senha?')) {
            const newPassword = prompt('Nova senha:');
            if (newPassword && newPassword.trim()) {
                user.passwordHash = await utils.hashPassword(newPassword.trim());
                app.users.create(user);
                alert('Senha alterada!');
            }
        }
        app.openUserManagement();
    },

    deleteUser: (username) => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') return;
        if (confirm(`Excluir usuário ${username}?`)) {
            app.users.delete(username);
            app.openUserManagement();
        }
    },

    openInstituicaoManagement: () => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') { alert('Apenas administradores'); return; }
        app.instituicoes.init();
        const instituicoes = app.instituicoes.getAll();
        const container = document.getElementById('instituicoes-list');
        if (!container) return;
        container.innerHTML = '';
        instituicoes.forEach(inst => {
            const logoPreview = inst.logo ? `<img src="${inst.logo}" class="w-8 h-8 rounded mr-2">` : '';
            const div = document.createElement('div');
            div.className = 'flex justify-between items-center p-2 bg-gray-100 rounded';
            div.innerHTML = `
                <div class="flex items-center">
                    ${logoPreview}
                    <div>
                        <p class="font-bold">${inst.nome}</p>
                        <p class="text-xs text-gray-600">${inst.cidade || 'Cidade não informada'}</p>
                    </div>
                </div>
                <div class="flex gap-2 items-center">
                    <button onclick="app.editInstituicao('${inst.id}')" class="text-blue-600 text-sm">Editar</button>
                    ${inst.id !== 'default' ? `<button onclick="app.deleteInstituicao('${inst.id}')" class="text-red-600 text-sm">Excluir</button>` : ''}
                </div>
            `;
            container.appendChild(div);
        });
        document.getElementById('instituicao-management-modal').classList.remove('hidden');
    },

    closeInstituicaoManagement: () => { document.getElementById('instituicao-management-modal').classList.add('hidden'); },

    createInstituicao: async () => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') return;
        const nome = document.getElementById('new-inst-nome').value.trim();
        const cidade = document.getElementById('new-inst-cidade').value.trim();
        const logoInput = document.getElementById('new-inst-logo');
        
        if (!nome) { alert('Informe o nome'); return; }
        
        let logoBase64 = null;
        if (logoInput.files[0]) {
            try {
                logoBase64 = await utils.compressImage(logoInput.files[0], 200, 200, 0.7);
            } catch (error) {
                alert('Erro ao processar logo: ' + error.message);
                return;
            }
        }
        
        app.instituicoes.create({ nome, cidade, logo: logoBase64 });
        alert(`Unidade criada!\n\n${nome}${cidade ? ' - ' + cidade : ''}${logoBase64 ? '\n✅ Logo carregado' : '\n⚠️ Sem logo (opcional)'}`);
        document.getElementById('new-inst-nome').value = '';
        document.getElementById('new-inst-cidade').value = '';
        logoInput.value = '';
        app.openInstituicaoManagement();
    },

    editInstituicao: async (id) => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') return;
        const inst = app.instituicoes.get(id);
        if (!inst) return;

        const novoNome = prompt('Nome da unidade:', inst.nome);
        if (novoNome === null) return; // cancelou
        if (!novoNome.trim()) { alert('Nome não pode ser vazio.'); return; }

        const novaCidade = prompt('Cidade:', inst.cidade || '');
        if (novaCidade === null) return;

        // Pede novo logo via input de arquivo temporário
        const trocarLogo = confirm('Deseja atualizar o logotipo?');
        let novaLogo = inst.logo || null;
        if (trocarLogo) {
            novaLogo = await new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async () => {
                    if (!input.files[0]) { resolve(inst.logo || null); return; }
                    try {
                        const compressed = await utils.compressImage(input.files[0], 200, 200, 0.7);
                        resolve(compressed);
                    } catch (e) {
                        alert('Erro ao processar imagem: ' + e.message);
                        resolve(inst.logo || null);
                    }
                };
                input.click();
            });
        }

        const updated = { ...inst, nome: novoNome.trim(), cidade: novaCidade.trim(), logo: novaLogo };
        localStorage.setItem(`inst_${id}`, JSON.stringify(updated));

        // Atualiza sessão ativa se for a instituição atual
        if (app.currentInstituicao?.id === id) {
            app.currentInstituicao = updated;
            const session = JSON.parse(localStorage.getItem('sessionData') || '{}');
            session.instituicao = updated;
            localStorage.setItem('sessionData', JSON.stringify(session));
            app.updateInstituicaoDisplay();
            app.updateLogoDisplay();
        }

        alert(`✅ Unidade atualizada!\n\n${updated.nome} - ${updated.cidade}`);
        app.openInstituicaoManagement();
    },

    deleteInstituicao: (id) => {
        if (!app.isLoggedIn || app.currentUser.level !== 'admin') return;
        if (confirm('Excluir esta unidade?')) {
            app.instituicoes.delete(id);
            app.openInstituicaoManagement();
        }
    },

    users: {
        init: async () => {
            // Migração: converte TODOS os usuários com senha em texto puro para hash,
            // inclusive o admin. Roda antes da criação do admin padrão.
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('user_')) {
                    try {
                        const user = JSON.parse(localStorage.getItem(key));
                        if (user && user.password && !user.passwordHash) {
                            user.passwordHash = await utils.hashPassword(user.password);
                            delete user.password;
                            localStorage.setItem(key, JSON.stringify(user));
                        }
                        // Corrige level inválido ou ausente
                        if (user && !['admin', 'editor', 'viewer'].includes(user.level)) {
                            user.level = user.username === 'admin' ? 'admin' : 'viewer';
                            localStorage.setItem(key, JSON.stringify(user));
                        }
                    } catch (e) {}
                }
            }
            // Cria admin padrão apenas se ainda não existir
            if (!localStorage.getItem('user_admin')) {
                const passwordHash = await utils.hashPassword('musica2026');
                localStorage.setItem('user_admin', JSON.stringify({ username: 'admin', passwordHash, level: 'admin', name: 'Administrador' }));
            }
        },
        create: (userData) => { localStorage.setItem(`user_${userData.username}`, JSON.stringify(userData)); },
        getAll: () => {
            const users = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('user_')) { try { users.push(JSON.parse(localStorage.getItem(key))); } catch (e) {} }
            }
            return users;
        },
        get: (username) => { const data = localStorage.getItem(`user_${username}`); return data ? JSON.parse(data) : null; },
        delete: (username) => {
            if (username === 'admin') { alert('Não pode excluir o admin'); return; }
            localStorage.removeItem(`user_${username}`);
            // Registra exclusão para sincronizar com a nuvem
            const tombstones = JSON.parse(localStorage.getItem('users_deleted') || '[]');
            if (!tombstones.includes(username)) tombstones.push(username);
            localStorage.setItem('users_deleted', JSON.stringify(tombstones));
        }
    },

    instituicoes: {
        init: () => {
            if (!localStorage.getItem('inst_default')) {
                localStorage.setItem('inst_default', JSON.stringify(APP_CONFIG.INSTITUICAO_PADRAO));
            }
            // Migração: renomeia instituição padrão se ainda tiver o nome antigo
            const instPadrao = localStorage.getItem('inst_default');
            if (instPadrao) {
                const inst = JSON.parse(instPadrao);
                if (inst.nome === 'Escola de Música') {
                    inst.nome = APP_CONFIG.INSTITUICAO_PADRAO.nome;
                    inst.cidade = APP_CONFIG.INSTITUICAO_PADRAO.cidade;
                    localStorage.setItem('inst_default', JSON.stringify(inst));
                }
            }
        },
        create: (instData) => {
            const id = 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(`inst_${id}`, JSON.stringify({ id, ...instData }));
        },
        getAll: () => {
            const instituicoes = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('inst_')) { try { instituicoes.push(JSON.parse(localStorage.getItem(key))); } catch (e) {} }
            }
            return instituicoes;
        },
        get: (id) => { const data = localStorage.getItem(`inst_${id}`); return data ? JSON.parse(data) : null; },
        delete: (id) => { if (id === 'default') { alert('Não pode excluir a unidade padrão'); return; } localStorage.removeItem(`inst_${id}`); }
    },

    accessLevels: {
        admin: { name: 'Administrador', canCreate: true, canEdit: true, canDelete: true, canBorrow: true, canMaintenance: true, canSync: true, canManageUsers: true },
        editor: { name: 'Editor', canCreate: true, canEdit: true, canDelete: false, canBorrow: true, canMaintenance: true, canSync: false, canManageUsers: false },
        viewer: { name: 'Visualizador', canCreate: false, canEdit: false, canDelete: false, canBorrow: false, canMaintenance: false, canSync: false, canManageUsers: false }
    }
};

document.addEventListener('DOMContentLoaded', app.init);
