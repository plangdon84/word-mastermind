import { suggestVoidedFewGuesses } from '../game';

/** On the result screen, when Suggest kept you from a few-guesses badge (README "Achievements"). Not with the badges, which load later. */
export function SuggestNote({ found, guesses, suggested }: { found: boolean; guesses: number; suggested: number }) {
  return suggestVoidedFewGuesses(found, guesses, suggested)
    ? <p class="tally">Suggest used: no few-guesses badge</p> : null;
}
