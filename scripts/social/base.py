from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
from playwright.sync_api import Page


@dataclass
class Post:
    title: Optional[str]   # used by platforms that require a title (Reddit)
    body: str              # main content


@dataclass
class PostResult:
    platform: str
    success: bool
    url: Optional[str] = None
    error: Optional[str] = None


class SocialPoster(ABC):
    platform: str

    def __init__(self, page: Page):
        self.page = page

    @abstractmethod
    def login(self) -> None:
        """Navigate to the platform and wait for the user to authenticate."""

    @abstractmethod
    def post(self, content: Post) -> PostResult:
        """Compose and submit a post, returning the result."""
