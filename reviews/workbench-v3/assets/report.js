document.querySelectorAll(".theme-toggle").forEach(button => {
  button.addEventListener("click", () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  });
});
const table = document.getElementById("matrix-table");
if (table) {
  const rows = Array.from(table.tBodies[0].rows);
  const search = document.getElementById("matrix-search");
  const category = document.getElementById("matrix-category");
  const kind = document.getElementById("matrix-kind");
  const sort = document.getElementById("matrix-sort");
  const update = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    rows.forEach(row => {
      row.hidden = !row.dataset.search.toLocaleLowerCase().includes(query) ||
        (category.value !== "" && row.dataset.category !== category.value) ||
        (kind.value !== "" && row.dataset.kind !== kind.value);
      if (!row.hidden) visible++;
    });
    const column = sort.value === "name" ? 2 : sort.value === "category" ? 1 : 0;
    rows.slice().sort((a, b) => {
      const text = row => column === 2
        ? row.querySelector("summary").textContent : row.cells[column].textContent;
      return text(a).localeCompare(text(b), "zh-CN", { numeric: true });
    }).forEach(row => table.tBodies[0].appendChild(row));
    document.getElementById("matrix-count").textContent = `${visible} / ${rows.length} 项`;
    document.getElementById("matrix-empty").hidden = visible !== 0;
  };
  search.addEventListener("input", update);
  category.addEventListener("change", update);
  kind.addEventListener("change", update);
  sort.addEventListener("change", update);
  document.getElementById("matrix-reset").addEventListener("click", () => {
    search.value = "";
    category.value = "";
    kind.value = "";
    sort.value = "id";
    update();
    search.focus();
  });
  update();
}
