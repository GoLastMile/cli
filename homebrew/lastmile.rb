# typed: false
# frozen_string_literal: true

# Homebrew formula for LastMile CLI
# To use this formula, create a tap repo: github.com/golastmile/homebrew-tap
# Then users can install with: brew install golastmile/tap/lastmile

class Lastmile < Formula
  desc "Ship your vibe-coded projects to production"
  homepage "https://github.com/golastmile/lastmile"
  version "0.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/golastmile/lastmile/releases/download/v#{version}/lastmile-darwin-arm64"
      sha256 "REPLACE_WITH_SHA256_DARWIN_ARM64"

      def install
        bin.install "lastmile-darwin-arm64" => "lastmile"
      end
    end

    on_intel do
      url "https://github.com/golastmile/lastmile/releases/download/v#{version}/lastmile-darwin-x64"
      sha256 "REPLACE_WITH_SHA256_DARWIN_X64"

      def install
        bin.install "lastmile-darwin-x64" => "lastmile"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/golastmile/lastmile/releases/download/v#{version}/lastmile-linux-x64"
      sha256 "REPLACE_WITH_SHA256_LINUX_X64"

      def install
        bin.install "lastmile-linux-x64" => "lastmile"
      end
    end
  end

  test do
    assert_match "lastmile", shell_output("#{bin}/lastmile --version")
  end
end
