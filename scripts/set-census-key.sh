#!/bin/zsh
# Saves your US Census Bureau API key privately on this Mac (never in the repository).
# Run: zsh ~/Desktop/teichopolitics-map/scripts/set-census-key.sh
set -e
mkdir -p ~/.config/census
read -s "KEY?Paste your Census key (it stays hidden), then press Enter: "
echo
KEY="${KEY//[[:space:]]/}"
if [ -z "$KEY" ]; then echo "No key entered; nothing saved."; exit 1; fi
echo "You pasted ${#KEY} characters, starting ${KEY[1,4]} and ending ${KEY[-4,-1]}."
if [ ${#KEY} -ne 40 ]; then
  echo "A Census key has 40 characters, so part of it is missing or extra. Copy it again from the email and rerun this script."
  exit 1
fi
printf '%s' "$KEY" > ~/.config/census/api_key
chmod 600 ~/.config/census/api_key
unset KEY
echo "Saved to ~/.config/census/api_key (readable only by you)."
echo "Testing it..."
RESULT=$(curl -s "https://api.census.gov/data/2023/acs/acs5/profile?get=NAME,DP03_0009PE&for=place:66000&in=state:06&key=$(cat ~/.config/census/api_key)")
case "$RESULT" in
  *"San Diego"*) echo "It works: $RESULT" ;;
  *) echo "The key did not work yet. Check that you clicked the activation link in the email, then run this script again." ;;
esac
