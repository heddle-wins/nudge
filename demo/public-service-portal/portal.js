const query = document.querySelector("#service-query");
const results = document.querySelector("#service-results");
const tracker = document.querySelector("#tracker");
const status = document.querySelector("#status-result");
const restricted = document.querySelector("#restricted");

document.querySelector("#find-service").addEventListener("click", () => {
  const searchTerm = query.value.trim();
  results.innerHTML = "";
  const card = document.createElement("section");
  card.className = "result-card";
  const title = document.createElement("h2");
  title.textContent = searchTerm ? `${searchTerm} application services` : "Scholarship application services";
  const copy = document.createElement("p");
  copy.textContent = "Open the tracker to view the fictional application status.";
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = "Open scholarship tracker";
  open.addEventListener("click", () => {
    tracker.hidden = false;
    tracker.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  card.append(title, copy, open);
  results.append(card);
});

document.querySelector("#view-status").addEventListener("click", () => {
  status.hidden = false;
  status.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.querySelector("#open-restricted").addEventListener("click", () => {
  restricted.hidden = false;
  restricted.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("form").addEventListener("submit", (event) => event.preventDefault());
