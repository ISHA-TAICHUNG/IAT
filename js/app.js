// 首頁 — 載入職類清單並渲染
async function loadCategories() {
    const res = await fetch("data/categories.json");
    return res.json();
}

function groupBy(arr, key) {
    return arr.reduce((acc, item) => {
        (acc[item[key]] = acc[item[key]] || []).push(item);
        return acc;
    }, {});
}

function renderCategories(cats) {
    const container = document.getElementById("cat-container");
    const groups = groupBy(cats, "group");
    const groupOrder = ["業務主管", "作業主管", "醫護", "外籍移工"];

    container.innerHTML = groupOrder
        .filter((g) => groups[g])
        .map(
            (group) => `
    <section class="group-section">
      <h3 class="group-title">${group}</h3>
      <div class="cat-grid">
        ${groups[group]
                    .map(
                        (cat) => `
          <div class="cat-card" onclick="startExam('${cat.id}')">
            <div class="cat-name">${cat.name}</div>
            <div class="cat-count">題庫共 ${cat.total} 題，每次隨機抽 80 題</div>
            <span class="cat-arrow">›</span>
          </div>`
                    )
                    .join("")}
      </div>
    </section>`
        )
        .join("");
}

function startExam(catId) {
    if (!catId) return;
    window.location.href = `exam.html?cat=${encodeURIComponent(catId)}`;
}

// 初始化
loadCategories()
    .then(renderCategories)
    .catch(() => {
        document.getElementById("cat-container").innerHTML =
            '<p style="color:red;padding:40px">載入職類失敗，請確認 data/categories.json 存在。</p>';
    });
