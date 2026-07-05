"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Play, Trash2, Wand2, BookMarked } from "lucide-react";
import styles from "./recipes.module.css";

type PlaylistRecipe = {
  id: string;
  name: string;
  description?: string | null;
  filterSummary: string;
  createdAt: string;
  lastUsedAt?: string | null;
  useCount: number;
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<PlaylistRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRecipes = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/playlist-recipes");
      setRecipes(res.data.recipes || []);
    } catch (e) {
      console.error(e);
      setError("Unable to load playlist recipes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  const deleteRecipe = async (recipe: PlaylistRecipe) => {
    if (!window.confirm(`Delete recipe "${recipe.name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/playlist-recipes/${recipe.id}`);
      setRecipes(recipes.filter((item) => item.id !== recipe.id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete playlist recipe");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <BookMarked size={14} />
            Saved Recipes
          </span>
          <h2>Playlist Recipes</h2>
          <p>Save and reuse playlist builder filter setups.</p>
        </div>
        <Link href="/builder" className={styles.primaryButton}>
          <Wand2 size={16} />
          Build Playlist
        </Link>
      </header>

      {loading ? (
        <div className={styles.statePanel}>Loading playlist recipes...</div>
      ) : error ? (
        <div className={styles.statePanel}>{error}</div>
      ) : recipes.length === 0 ? (
        <section className={styles.emptyState}>
          <BookMarked size={28} />
          <h3>No playlist recipes saved yet.</h3>
          <p>Build a playlist, choose your filters, then save it as a recipe to reuse later.</p>
          <Link href="/builder" className={styles.primaryButton}>
            <Wand2 size={16} />
            Build Playlist
          </Link>
        </section>
      ) : (
        <section className={styles.recipeGrid} aria-label="Saved playlist recipes">
          {recipes.map((recipe) => (
            <article key={recipe.id} className={styles.recipeCard}>
              <div className={styles.cardTop}>
                <div>
                  <h3>{recipe.name}</h3>
                  {recipe.description && <p>{recipe.description}</p>}
                </div>
                <span>{recipe.useCount} use{recipe.useCount === 1 ? "" : "s"}</span>
              </div>

              <dl className={styles.metaGrid}>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(recipe.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{formatDate(recipe.lastUsedAt)}</dd>
                </div>
              </dl>

              <p className={styles.summary}>{recipe.filterSummary || "No filters saved."}</p>

              <div className={styles.actions}>
                <Link href={`/builder?recipeId=${recipe.id}`} className={styles.secondaryButton}>
                  <Wand2 size={15} />
                  Use Recipe
                </Link>
                <Link href={`/builder?recipeId=${recipe.id}&preview=1`} className={styles.secondaryButton}>
                  <Play size={15} />
                  Preview
                </Link>
                <button type="button" onClick={() => deleteRecipe(recipe)} className={styles.dangerButton}>
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
