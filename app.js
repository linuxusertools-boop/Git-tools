let TOKEN = "";

document.addEventListener("DOMContentLoaded", () => { 
    renderHistory(); 
});

function writeLog(text, color = "#00ff66") {
    const l = document.getElementById('log'); 
    l.style.display = "block";
    const e = document.createElement('div'); 
    e.style.color = color; 
    e.textContent = "› " + text;
    l.appendChild(e); 
    l.scrollTop = l.scrollHeight;
}

async function getBase64(data) {
    return new Promise(r => {
        const reader = new FileReader();
        reader.onload = e => r(window.btoa(e.target.result));
        reader.readAsBinaryString(new Blob([data]));
    });
}

async function connect() {
    TOKEN = document.getElementById('token').value.trim();
    if(!TOKEN) return;
    try {
        const res = await fetch('https://api.github.com/user/repos?per_page=100', { 
            headers: {'Authorization': `token ${TOKEN}`} 
        });
        if(!res.ok) throw new Error("Invalid Token");
        const d = await res.json();
        document.getElementById('repoList').innerHTML = d.map(r => `<option value="${r.full_name}">${r.full_name}</option>`).join('');
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');
        writeLog("Ready.");
    } catch(e) { 
        alert(e.message); 
    }
}

async function startDeploy() {
    const repo = document.getElementById('repoList').value;
    const file = document.getElementById('zipInput').files[0];
    if(!file) return alert("Pilih ZIP!");
    const btn = document.getElementById('deployBtn'); 
    btn.disabled = true;
    
    try {
        writeLog(`Initializing ${repo}...`);
        const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { 
            headers: {'Authorization': `token ${TOKEN}`} 
        });
        const repoInfo = await repoRes.json();
        const branch = repoInfo.default_branch;
        
        const branchRes = await fetch(`https://api.github.com/repos/${repo}/branches/${branch}`, { 
            headers: {'Authorization': `token ${TOKEN}`} 
        });
        const branchInfo = await branchRes.json();
        const parentSha = branchInfo.commit.sha;
        
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const files = Object.keys(zip.files).filter(k => !zip.files[k].dir);
        
        const firstFolder = files[0].split('/')[0];
        const isNested = files.every(f => f.startsWith(firstFolder + '/'));
        
        const tree = [];
        for(const f of files) {
            writeLog("Push: " + f);
            const content = await zip.files[f].async("uint8array");
            const b64 = await getBase64(content);
            const blobRes = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
                method: 'POST', 
                headers: {'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json'},
                body: JSON.stringify({ content: b64, encoding: 'base64' })
            });
            const blob = await blobRes.json();
            
            const githubPath = isNested ? f.substring(f.indexOf('/') + 1) : f;
            if(!githubPath) continue;

            tree.push({ path: githubPath, mode: "100644", type: "blob", sha: blob.sha });
        }
        
        const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
            method: 'POST', 
            headers: {'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({ tree })
        });
        const newTree = await treeRes.json();
        
        const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
            method: 'POST', 
            headers: {'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({ message: "⚡ kev-git build", tree: newTree.sha, parents: [parentSha] })
        });
        const commit = await commitRes.json();
        
        await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
            method: 'PATCH', 
            headers: {'Authorization': `token ${TOKEN}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({ sha: commit.sha, force: true })
        });
        
        writeLog("Deployment success.", "#50e3c2");
        saveHistory(repo);
        alert("Done!");
    } catch(e) { 
        writeLog("Error: " + e.message, "#ee0000"); 
    } finally { 
        btn.disabled = false; 
    }
}

function saveHistory(repo) {
    let history = JSON.parse(localStorage.getItem('kg_hist')) || [];
    const newLog = { repo: repo, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
    history.unshift(newLog);
    if(history.length > 3) history.pop();
    localStorage.setItem('kg_hist', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('kg_hist')) || [];
    const container = document.getElementById('historyContainer');
    if(history.length === 0) {
        container.innerHTML = '<div class="history-empty">No deployments logged.</div>';
        return;
    }
    container.innerHTML = history.map(item => `
        <div class="history-item">
            <span class="history-repo">${item.repo}</span>
            <span class="history-time">${item.time}</span>
        </div>
    `).join('');
}

function clearHistory() {
    localStorage.removeItem('kg_hist');
    renderHistory();
}
